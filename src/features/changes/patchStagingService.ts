import type { GitCliRegistry } from '../../core/gitCliRegistry';
import type { GitExtensionService } from '../../core/gitExtensionService';
import type { Repository } from '../../core/vscodeGitApi';
import { buildHunkPatch, buildLinePatch } from '../../core/gitDiffPatch';
import {
  findDiffFileForPath,
  parseUnifiedDiff,
  type ParsedDiffFile,
} from '../../core/gitDiffParser';
import { assertRepoRelativePath } from './workingCopyModel';
import type {
  WorkingCopyDiffLineDto,
  WorkingCopyDiffHunkDto,
  WorkingCopyFileDiffDto,
  WorkingCopyPatchAction,
  WorkingCopyDiffSide,
} from '../../shared/changes/workingCopyProtocol';
import { createLogger } from '../../log';
import { buildWorkingCopyDiffArgs } from '../../core/gitDiffArgs';
import { loadNonTextDiffSummary } from './nonTextDiffLoader';
import type { BinaryBlobSlice } from '../../shared/diff/binaryPayload';
import { defaultChunkSize } from '../../shared/diff/binaryPayload';
import { loadBinaryChunk, parseBlobRef } from './nonTextDiffLoader';
import {
  DEFAULT_WORKING_COPY_DIFF_VIEW_OPTIONS,
  type WorkingCopyDiffViewOptions,
} from '../../shared/diff/diffViewOptions';
import * as l10n from '@vscode/l10n';
import { RepositoryNotOpenError } from '../../core/repositoryNotOpenError';

const log = createLogger('patch-staging');

export class PatchStagingService {
  constructor(
    private readonly gitService: GitExtensionService,
    private readonly cliRegistry: GitCliRegistry,
  ) {}

  async loadFileDiff(
    repoRoot: string,
    filePath: string,
    side: WorkingCopyDiffSide,
    viewOptions: WorkingCopyDiffViewOptions = DEFAULT_WORKING_COPY_DIFF_VIEW_OPTIONS,
  ): Promise<WorkingCopyFileDiffDto> {
    const rel = assertRepoRelativePath(filePath);
    const repo = this.gitService.getRepositories().find((r) => r.rootUri.fsPath === repoRoot);
    if (!repo) {
      return emptyDiff(rel, side, l10n.t('Repository is not open.'));
    }

    try {
      const cli = this.cliRegistry.forRepository(repo);
      const args = buildWorkingCopyDiffArgs(side, rel, viewOptions);
      const result = await cli.execRead(args);
      const parsed = parseUnifiedDiff(result.stdout);
      const file = findDiffFileForPath(parsed.files, rel);
      if (!file) {
        return {
          path: rel,
          side,
          binary: false,
          nonTextKind: 'none',
          hunks: [],
          warnings: parsed.warnings,
        };
      }

      const nonText = await loadNonTextDiffSummary(
        cli,
        repoRoot,
        rel,
        side,
        file,
        result.stdout,
      );
      if (nonText || file.binary) {
        const summary =
          nonText ??
          (await loadNonTextDiffSummary(cli, repoRoot, rel, side, file, result.stdout));
        return {
          path: rel,
          side,
          binary: true,
          nonTextKind: summary?.kind ?? 'binary',
          imageMode: summary?.kind === 'image' ? viewOptions.imageMode : undefined,
          blobs: summary?.blobs ?? [],
          lfsComparison: summary?.lfsComparison,
          submodule: summary?.submodule,
          hunks: [],
          warnings: parsed.warnings,
        };
      }
      return {
        path: rel,
        side,
        binary: false,
        nonTextKind: 'none',
        hunks: file.hunks.map((hunk, hunkIndex) => toHunkDto(hunk, hunkIndex)),
        warnings: parsed.warnings,
      };
    } catch (error) {
      log.warn(`diff failed for ${rel}`, error);
      return emptyDiff(rel, side, l10n.t('Could not load diff for this file.'));
    }
  }

  async loadBinaryChunk(
    blobRef: string,
    offset: number,
    maxBytes = defaultChunkSize(),
  ): Promise<BinaryBlobSlice | null> {
    const parsed = parseBlobRef(blobRef);
    if (!parsed) {
      return null;
    }
    const repo = this.gitService
      .getRepositories()
      .find((r) => r.rootUri.fsPath === parsed.repoRoot);
    if (!repo) {
      return null;
    }
    const cli = this.cliRegistry.forRepository(repo);
    const rel = assertRepoRelativePath(parsed.path);
    return loadBinaryChunk(cli, parsed.repoRoot, rel, parsed.diffSide, parsed.blobSide, offset, maxBytes);
  }

  /**
   * Applies a hunk patch built from the diff on screen. It tolerates whitespace and context
   * differences, since the diff may have been produced with the toolbar's options.
   */
  async applyHunkPatch(repoRoot: string, op: 'stage' | 'unstage' | 'discard', patch: string): Promise<void> {
    const flags = ['--recount', '--unidiff-zero', '--ignore-whitespace', '--whitespace=nowarn'];
    const args =
      op === 'stage'
        ? ['apply', '--cached', ...flags]
        : op === 'unstage'
          ? ['apply', '--cached', '--reverse', ...flags]
          : ['apply', '--reverse', ...flags];
    log.info(`${op} hunk`);
    // `execWriteWithInput` takes the repository's write queue itself, so it must not run inside `runWrite`.
    await this.cliRegistry.getOrCreate(repoRoot).execWriteWithInput(args, patch, { showErrorToast: true });
  }

  async runPatchAction(repoRoot: string, action: WorkingCopyPatchAction): Promise<void> {
    const rel = assertRepoRelativePath(action.path);
    const patch = await this.selectionPatch(repoRoot, action);
    log.info(`${action.op} ${rel}`);
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    await cli.execWriteWithInput(buildApplyArgs(action), patch, { showErrorToast: true });
  }

  async selectionPatch(repoRoot: string, action: WorkingCopyPatchAction): Promise<string> {
    const rel = assertRepoRelativePath(action.path);
    const repo = this.gitService.getRepositories().find((r) => r.rootUri.fsPath === repoRoot);
    if (!repo) {
      throw new RepositoryNotOpenError();
    }
    const file = await this.loadParsedFile(repo, rel, patchSideForAction(action));
    if (!file) {
      throw new Error(l10n.t('No diff available for this selection.'));
    }
    const patch = buildPatchFromAction(file, action);
    if (!patch.trim()) {
      throw new Error(l10n.t('Nothing to apply for this selection.'));
    }
    return patch;
  }

  private async loadParsedFile(
    repo: Repository,
    rel: string,
    side: WorkingCopyDiffSide,
  ): Promise<ParsedDiffFile | null> {
    const cli = this.cliRegistry.forRepository(repo);
    const args =
      side === 'staged'
        ? ['diff', '--cached', '--no-color', '--', rel]
        : ['diff', '--no-color', '--', rel];
    const result = await cli.execRead(args);
    const parsed = parseUnifiedDiff(result.stdout);
    const file = findDiffFileForPath(parsed.files, rel);
    return file ?? null;
  }
}

function patchSideForAction(action: WorkingCopyPatchAction): WorkingCopyDiffSide {
  switch (action.op) {
    case 'stageHunk':
    case 'stageLine':
    case 'discardHunk':
    case 'discardLine':
      return 'unstaged';
    case 'unstageHunk':
    case 'unstageLine':
      return 'staged';
    case 'stashHunk':
    case 'stashLine':
      return action.side;
  }
}

function buildPatchFromAction(file: ParsedDiffFile, action: WorkingCopyPatchAction): string {
  if (
    action.op === 'stageHunk' ||
    action.op === 'unstageHunk' ||
    action.op === 'discardHunk' ||
    action.op === 'stashHunk'
  ) {
    const hunkIndex = parseHunkId(action.hunkId);
    return buildHunkPatch(file, hunkIndex);
  }
  const { hunkIndex, lineIndex } = parseLineId(action.lineId);
  return buildLinePatch(file, hunkIndex, lineIndex);
}

function buildApplyArgs(action: WorkingCopyPatchAction): string[] {
  switch (action.op) {
    case 'stageHunk':
    case 'stageLine':
      return ['apply', '--cached', '--whitespace=nowarn'];
    case 'unstageHunk':
    case 'unstageLine':
      return ['apply', '--cached', '--reverse', '--whitespace=nowarn'];
    case 'discardHunk':
    case 'discardLine':
      return ['apply', '--reverse', '--whitespace=nowarn'];
    case 'stashHunk':
    case 'stashLine':
      throw new Error(l10n.t('Stash selections are stored with git stash.'));
  }
}

function parseHunkId(hunkId: string): number {
  const value = Number(hunkId);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('Invalid hunk id.');
  }
  return value;
}

function parseLineId(lineId: string): { hunkIndex: number; lineIndex: number } {
  const parts = lineId.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid line id.');
  }
  const hunkIndex = Number(parts[0]);
  const lineIndex = Number(parts[1]);
  if (!Number.isInteger(hunkIndex) || !Number.isInteger(lineIndex) || hunkIndex < 0 || lineIndex < 0) {
    throw new Error('Invalid line id.');
  }
  return { hunkIndex, lineIndex };
}

function toHunkDto(
  hunk: import('../../core/gitDiffParser').ParsedDiffHunk,
  hunkIndex: number,
): WorkingCopyDiffHunkDto {
  return {
    id: String(hunkIndex),
    header: hunk.headerLine,
    lines: hunk.lines.flatMap((line, lineIndex) => {
        if (line.kind === 'noNewline') {
          return [];
        }
        return [{
          id: `${hunkIndex}:${lineIndex}`,
          kind: line.kind,
          text: line.raw.startsWith('+') || line.raw.startsWith('-') || line.raw.startsWith(' ')
            ? line.raw.slice(1)
            : line.raw,
          selectable: line.kind === 'add' || line.kind === 'del',
        } satisfies WorkingCopyDiffLineDto];
      }),
  };
}

function emptyDiff(
  path: string,
  side: WorkingCopyDiffSide,
  message?: string,
): WorkingCopyFileDiffDto {
  return {
    path,
    side,
    binary: false,
    nonTextKind: 'none',
    hunks: [],
    error: message,
  };
}
