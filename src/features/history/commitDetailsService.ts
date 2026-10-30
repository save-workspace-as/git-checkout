import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createLogger } from '../../log';
import { commitDiffGitArgs, DEFAULT_COMMIT_DIFF_VIEW, type CommitDiffViewOptions } from '../../shared/diff/commitDiffPresentation';
import { commitCompareDiffArgs, commitDetailsDiffArgs, parseCommitNameStatus } from '../../shared/history/commitDetails';
import type { CommitDiffLineDto, CommitFileChangeDto, CommitPersonDto } from '../../shared/history/commitDetailsProtocol';
import { parseUnifiedDiff } from '../../core/gitDiffParser';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import { GitCliError } from '../../core/gitCliError';
import { inlineBytes } from '../changes/nonTextDiffLoader';
import { MAX_IMAGE_PREVIEW_BYTES, MAX_INLINE_BINARY_BYTES } from '../../shared/diff/binaryDiffLimits';
import { detectContentKind } from '../../shared/diff/contentKind';
import { DEFAULT_WORKING_COPY_DIFF_VIEW_OPTIONS } from '../../shared/diff/diffViewOptions';
import type { WorkingCopyBinaryBlobDto, WorkingCopyFileDiffDto } from '../../shared/changes/workingCopyProtocol';

const log = createLogger('commit-details');

export const EMPTY_COMMIT_PERSON: CommitPersonDto = { name: '', email: '', date: 0 };

/** Parses `git log -1 --format=%cn%x1f%ce%x1f%ct`. */
export function parseCommitterRecord(output: string): CommitPersonDto {
  const [name = '', email = '', date = ''] = output.replace(/\n+$/, '').split('\x1f');
  const unix = Number(date);
  return {
    name,
    email,
    date: Number.isFinite(unix) ? unix : 0,
  };
}

export function commitDiffLines(stdout: string): { binary: boolean; lines: CommitDiffLineDto[] } {
  const parsed = parseUnifiedDiff(stdout);
  const file = parsed.files[0];
  if (!file) {
    return { binary: false, lines: [] };
  }
  if (file.binary) {
    return { binary: true, lines: [] };
  }
  const lines: CommitDiffLineDto[] = [];
  for (const hunk of file.hunks) {
    lines.push({ kind: 'hunk', text: hunk.headerLine });
    for (const line of hunk.lines) {
      if (line.kind === 'noNewline') {
        const previous = lines[lines.length - 1];
        if (previous && previous.kind !== 'hunk') {
          previous.noEol = true;
        }
        continue;
      }
      const text =
        line.raw.startsWith('+') || line.raw.startsWith('-') || line.raw.startsWith(' ')
          ? line.raw.slice(1)
          : line.raw;
      const lineNo = line.kind === 'del' ? line.oldLineNo : line.newLineNo;
      lines.push({ kind: line.kind, text, line: lineNo ?? undefined });
    }
  }
  return { binary: false, lines };
}

/** Both sides of a rename, so git can pair them instead of showing an empty diff for the new name. */
function diffPaths(filePath: string, oldPath: string | undefined): string[] {
  return oldPath && oldPath !== filePath ? [oldPath, filePath] : [filePath];
}

export class CommitDetailsService {
  constructor(private readonly cliRegistry: GitCliRegistry) {}

  async listFiles(repoRoot: string, sha: string): Promise<CommitFileChangeDto[]> {
    const revision = sha.trim();
    const result = await this.cliRegistry.getOrCreate(repoRoot).execRead(commitDetailsDiffArgs(revision));
    const files = parseCommitNameStatus(result.stdout);
    log.debug(`listed ${files.length} files at ${revision}`);
    return files;
  }

  /**
   * One working-copy file's change, staged (index against HEAD) or not (working tree against index).
   * An untracked file has nothing to diff against, so it shows as all added.
   */
  async diffWorkingFile(
    repoRoot: string,
    filePath: string,
    side: 'staged' | 'unstaged',
    untracked: boolean,
    view: CommitDiffViewOptions = DEFAULT_COMMIT_DIFF_VIEW,
  ): Promise<{ binary: boolean; lines: CommitDiffLineDto[] }> {
    if (untracked) {
      const content = await readFile(join(repoRoot, filePath));
      if (content.includes(0)) {
        return { binary: true, lines: [] };
      }
      const text = content.toString('utf8');
      const rows = text.length === 0 ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/);
      return {
        binary: false,
        lines: rows.length === 0
          ? []
          : [
              { kind: 'hunk', text: `@@ -0,0 +1,${rows.length} @@` },
              ...rows.map((row, index) => ({ kind: 'add' as const, text: row, line: index + 1 })),
            ],
      };
    }
    const result = await this.cliRegistry.getOrCreate(repoRoot).execRead([
      'diff',
      ...(side === 'staged' ? ['--cached'] : []),
      '--no-color',
      '-p',
      '-M',
      ...commitDiffGitArgs(view),
      '--',
      filePath,
    ]);
    return commitDiffLines(result.stdout);
  }

  /** Files that differ between `base` and `sha`. */
  async listFilesBetween(repoRoot: string, base: string, sha: string): Promise<CommitFileChangeDto[]> {
    const result = await this.cliRegistry
      .getOrCreate(repoRoot)
      .execRead(commitCompareDiffArgs(base.trim(), sha.trim()));
    const files = parseCommitNameStatus(result.stdout);
    log.debug(`listed ${files.length} files between ${base.trim()} and ${sha.trim()}`);
    return files;
  }

  async diffFileBetween(
    repoRoot: string,
    base: string,
    sha: string,
    filePath: string,
    view: CommitDiffViewOptions = DEFAULT_COMMIT_DIFF_VIEW,
    oldPath?: string,
  ): Promise<{ binary: boolean; lines: CommitDiffLineDto[] }> {
    const result = await this.cliRegistry.getOrCreate(repoRoot).execRead([
      'diff',
      '--no-color',
      '-p',
      '-M',
      ...commitDiffGitArgs(view),
      base.trim(),
      sha.trim(),
      '--',
      ...diffPaths(filePath, oldPath),
    ]);
    return commitDiffLines(result.stdout);
  }

  /** Message body without the subject line. */
  async readBody(repoRoot: string, sha: string): Promise<string> {
    const revision = sha.trim();
    const result = await this.cliRegistry
      .getOrCreate(repoRoot)
      .execRead(['log', '-1', '--format=%b', revision]);
    return result.stdout.replace(/\n+$/, '');
  }

  async readMessage(repoRoot: string, revision: string): Promise<string> {
    const tag = revision.trim();
    try {
      const result = await this.cliRegistry.getOrCreate(repoRoot).execRead([
        'log', '-1', '--format=%B', `${tag}^{}`,
      ]);
      return result.stdout.replace(/\n+$/, '');
    } catch (error) {
      log.error(`failed to read full message for ${tag}`, error);
      throw error;
    }
  }

  async readCommitter(repoRoot: string, sha: string): Promise<CommitPersonDto> {
    const revision = sha.trim();
    const result = await this.cliRegistry
      .getOrCreate(repoRoot)
      .execRead(['log', '-1', '--format=%cn%x1f%ce%x1f%ct', revision]);
    return parseCommitterRecord(result.stdout);
  }

  async diffFile(
    repoRoot: string,
    sha: string,
    filePath: string,
    view: CommitDiffViewOptions = DEFAULT_COMMIT_DIFF_VIEW,
    oldPath?: string,
  ): Promise<{ binary: boolean; lines: CommitDiffLineDto[] }> {
    const result = await this.cliRegistry.getOrCreate(repoRoot).execRead([
      'show',
      '--format=',
      '--no-color',
      '-p',
      '-M',
      ...commitDiffGitArgs(view),
      sha.trim(),
      '--',
      ...diffPaths(filePath, oldPath),
    ]);
    return commitDiffLines(result.stdout);
  }

  /**
   * What a binary file looked like on each side of a commit (or comparison), so images can be
   * shown and other binaries described. `base` is null for a root commit.
   */
  async binaryPreview(
    repoRoot: string,
    base: string | null,
    sha: string,
    filePath: string,
  ): Promise<WorkingCopyFileDiffDto> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    const read = async (revision: string | null): Promise<Uint8Array> => {
      if (!revision) {
        return new Uint8Array();
      }
      try {
        const result = await cli.execRead(['show', `${revision}:${filePath}`], { binaryStdout: true });
        return result.stdoutBytes ?? new Uint8Array();
      } catch (error) {
        // The file does not exist on this side (added or deleted); that is an empty side.
        log.debug(`no ${filePath} at ${revision}`, error);
        return new Uint8Array();
      }
    };
    const sides = [
      { side: 'old' as const, revision: base, bytes: await read(base) },
      { side: 'new' as const, revision: sha, bytes: await read(sha) },
    ].map((entry) => ({ ...entry, kind: detectContentKind(entry.bytes) }));
    const blobs: WorkingCopyBinaryBlobDto[] = sides.map(({ side, revision, bytes, kind }) => ({
      side,
      mimeType: kind.mimeType,
      byteLength: bytes.length,
      blobRef: `commit\0${revision ?? ''}\0${filePath}\0${side}`,
      inline:
        bytes.length > 0 && (bytes.length <= MAX_INLINE_BINARY_BYTES || (kind.kind === 'image' && bytes.length <= MAX_IMAGE_PREVIEW_BYTES))
          ? inlineBytes(bytes, kind)
          : undefined,
      lfs: kind.lfs,
    }));
    const lfs = sides.some(({ kind }) => kind.kind === 'lfs-pointer');
    const image = sides.some(({ kind }) => kind.kind === 'image');
    const tooLarge = sides.some(({ bytes }) => bytes.length > MAX_IMAGE_PREVIEW_BYTES);
    return {
      path: filePath,
      side: 'staged',
      binary: true,
      nonTextKind: lfs ? 'lfs' : image && !tooLarge ? 'image' : 'binary',
      imageMode: DEFAULT_WORKING_COPY_DIFF_VIEW_OPTIONS.imageMode,
      blobs,
      lfsComparison: lfs ? { old: sides[0].kind.lfs, new: sides[1].kind.lfs } : undefined,
      hunks: [],
    };
  }

  /**
   * The picture stored at `revision:filePath`, when the file is one. Its size is read first, so a huge file is never
   * pulled into memory. `undefined` means this is not a picture the preview can draw, and the caller shows text.
   */
  async readImage(
    repoRoot: string,
    revision: string,
    filePath: string,
  ): Promise<{ kind: 'image'; mimeType: string; bytes: Uint8Array } | { kind: 'too-large'; byteLength: number } | undefined> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    const spec = `${revision}:${filePath}`;
    let byteLength: number;
    try {
      byteLength = Number.parseInt((await cli.execRead(['cat-file', '-s', spec])).stdout.trim(), 10);
    } catch (error) {
      // The path is not a file at this revision; the text preview reports that.
      log.debug(`no ${filePath} at ${revision}`, error);
      return undefined;
    }
    if (!Number.isFinite(byteLength)) {
      return undefined;
    }
    if (byteLength > MAX_IMAGE_PREVIEW_BYTES) {
      return { kind: 'too-large', byteLength };
    }
    const bytes = (await cli.execRead(['show', spec], { binaryStdout: true })).stdoutBytes ?? new Uint8Array();
    const detected = detectContentKind(bytes);
    return detected.kind === 'image' && detected.mimeType
      ? { kind: 'image', mimeType: detected.mimeType, bytes }
      : undefined;
  }

  /** First parent, or null for a root commit. */
  async resolveParent(repoRoot: string, sha: string): Promise<string | null> {
    try {
      const result = await this.cliRegistry
        .getOrCreate(repoRoot)
        .execRead(['rev-parse', '--verify', `${sha.trim()}^`]);
      const parent = result.stdout.trim();
      return parent || null;
    } catch (error) {
      if (error instanceof GitCliError && error.code === 'ExitCode') {
        log.debug(`commit ${sha.trim()} has no parent`, error);
        return null;
      }
      throw error;
    }
  }
}
