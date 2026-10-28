import type { GitCliRegistry } from '../../core/gitCliRegistry';
import { GitCliError } from '../../core/gitCliError';
import type { HistoryService } from './historyService';
import type { CommitPatchFormat } from '../../shared/patches/patchProtocol';
import {
  buildBranchCommitRange,
  buildRangeFromOrderedShas,
  detectPatchApplyKind,
  gitArgsForPatchApply,
  gitArgsForPatchExport,
  mapPatchApplyError,
  PATCH_CHECK_ARGS,
} from './commitRangePatch';
import { createLogger } from '../../log';
import * as l10n from '@vscode/l10n';

const log = createLogger('commit-patch');

export class CommitPatchService {
  constructor(
    private readonly cliRegistry: GitCliRegistry,
    private readonly historyService: HistoryService,
  ) {}

  async exportRange(repoRoot: string, range: string, format: CommitPatchFormat): Promise<string> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    const args = gitArgsForPatchExport(range, format);
    const result = await cli.execRead(args);
    const text = result.stdout;
    if (!text.trim()) {
      throw new Error(l10n.t('No patch content for this range.'));
    }
    return text;
  }

  async exportCommits(
    repoRoot: string,
    shas: string[],
    format: CommitPatchFormat,
  ): Promise<string> {
    const ordered = await this.historyService.orderOldestFirst(repoRoot, shas);
    const range = buildRangeFromOrderedShas(ordered);
    return this.exportRange(repoRoot, range, format);
  }

  async exportBranchCompare(
    repoRoot: string,
    base: string,
    compare: string,
    format: CommitPatchFormat,
  ): Promise<string> {
    const range = buildBranchCommitRange(base, compare);
    return this.exportRange(repoRoot, range, format);
  }

  /** What stops the patch from applying, or `undefined` when it applies cleanly. */
  async checkApply(repoRoot: string, patchText: string): Promise<string | undefined> {
    try {
      detectPatchApplyKind(patchText);
      const cli = this.cliRegistry.getOrCreate(repoRoot);
      await cli.execWriteWithInput(PATCH_CHECK_ARGS, patchText, { showErrorToast: false });
      return undefined;
    } catch (error) {
      log.debug('patch does not apply', error);
      if (error instanceof GitCliError) {
        return mapPatchApplyError(error.stderr ?? '', error.exitCode);
      }
      return error instanceof Error ? error.message : String(error);
    }
  }

  async applyFromText(repoRoot: string, patchText: string, createCommit = true): Promise<void> {
    const kind = detectPatchApplyKind(patchText);
    log.info(`apply patch (${kind})`);
    try {
      await this.cliRegistry.runWrite(repoRoot, async () => {
        const cli = this.cliRegistry.getOrCreate(repoRoot);
        const args = gitArgsForPatchApply(kind, createCommit);
        await cli.execWriteWithInput(args, patchText, { showErrorToast: false });
      });
    } catch (error) {
      if (error instanceof GitCliError) {
        throw new Error(mapPatchApplyError(error.stderr ?? '', error.exitCode));
      }
      throw error;
    }
  }
}
