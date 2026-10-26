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

  async applyFromText(repoRoot: string, patchText: string): Promise<void> {
    const kind = detectPatchApplyKind(patchText);
    log.info(`apply patch (${kind})`);
    try {
      await this.cliRegistry.runWrite(repoRoot, async () => {
        const cli = this.cliRegistry.getOrCreate(repoRoot);
        const args = gitArgsForPatchApply(kind);
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
