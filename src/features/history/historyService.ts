import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import type { GitExecOptions } from '../../core/gitCli';
import { createLogger } from '../../log';
import { lastUndoableOperation, parseReflog, type UndoableOperation } from './undoOperation';
import {
  defaultGitCheckoutSettings,
  type GitCheckoutSettingsReader,
} from '../../core/gitCheckoutSettings';

const log = createLogger('history');

export type ResetMode = 'soft' | 'mixed' | 'hard' | 'keep';

export interface HistoryRunOptions {
  cancellationToken?: vscode.CancellationToken;
}

export class HistoryService {
  constructor(
    private readonly cliRegistry: GitCliRegistry,
    private readonly settings: GitCheckoutSettingsReader = defaultGitCheckoutSettings,
  ) {}

  async reset(
    repoRoot: string,
    mode: ResetMode,
    treeish: string,
    options?: HistoryRunOptions,
  ): Promise<void> {
    const flag = { soft: '--soft', mixed: '--mixed', hard: '--hard', keep: '--keep' }[mode];
    await this.runWrite(repoRoot, ['reset', flag, treeish], options);
  }

  /** What last moved the checked-out branch, and what it pointed at before; `undefined` when there is none. */
  async lastOperation(
    repoRoot: string,
  ): Promise<(UndoableOperation & { branch: string; previousSummary: string }) | undefined> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    let branch: string;
    try {
      branch = (await cli.execRead(['symbolic-ref', '--short', '-q', 'HEAD'])).stdout.trim();
    } catch (error) {
      // A detached HEAD has no branch to move back; `symbolic-ref -q` exits 1 for it.
      log.debug('no branch to undo on', error);
      return undefined;
    }
    const reflog = await cli.execRead(['reflog', 'show', '-n', '2', '--format=%H%x00%gs', `refs/heads/${branch}`, '--']);
    const operation = lastUndoableOperation(parseReflog(reflog.stdout));
    if (!operation) {
      return undefined;
    }
    const previous = await cli.execRead(['log', '-1', '--format=%h %s', operation.previousSha, '--']);
    return { ...operation, branch, previousSummary: previous.stdout.trim() };
  }

  async cherryPick(
    repoRoot: string,
    sha: string,
    mainline?: number,
    options?: HistoryRunOptions,
  ): Promise<void> {
    const args = ['cherry-pick'];
    if (mainline !== undefined) {
      args.push('-m', String(mainline));
    }
    args.push(sha);
    if (this.settings.gitSkipHooks()) {
      args.push('--no-verify');
    }
    await this.runWrite(repoRoot, args, options);
  }

  async revert(repoRoot: string, sha: string, mainline: number, options?: HistoryRunOptions): Promise<void> {
    const args = ['revert', '-m', String(mainline), sha];
    if (this.settings.gitSkipHooks()) {
      args.push('--no-verify');
    }
    await this.runWrite(repoRoot, args, options);
  }

  async cherryPickRange(
    repoRoot: string,
    shas: string[],
    options?: HistoryRunOptions,
  ): Promise<void> {
    const ordered = await this.orderOldestFirst(repoRoot, shas);
    if (ordered.length === 0) {
      return;
    }
    const oldest = ordered[0];
    const newest = ordered[ordered.length - 1];
    const args = ['cherry-pick', `${oldest}^..${newest}`];
    if (this.settings.gitSkipHooks()) {
      args.push('--no-verify');
    }
    await this.runWrite(repoRoot, args, options);
  }

  async squashRange(
    repoRoot: string,
    shas: string[],
    message: string,
    options?: HistoryRunOptions,
  ): Promise<void> {
    const ordered = await this.orderOldestFirst(repoRoot, shas);
    await this.assertContiguousOnHead(repoRoot, ordered);
    const oldest = ordered[0];
    const parent = (await this.cli(repoRoot).execRead(['rev-parse', `${oldest}^`])).stdout.trim();
    await this.runWrite(repoRoot, ['reset', '--soft', parent], options);
    const commitArgs = ['commit', '-m', message];
    if (this.settings.gitSkipHooks()) {
      commitArgs.push('--no-verify');
    }
    await this.runWrite(repoRoot, commitArgs, options);
  }

  async dropRange(repoRoot: string, shas: string[], options?: HistoryRunOptions): Promise<void> {
    const ordered = await this.orderOldestFirst(repoRoot, shas);
    await this.assertContiguousOnHead(repoRoot, ordered);
    const oldest = ordered[0];
    const newest = ordered[ordered.length - 1];
    const cli = this.cli(repoRoot);
    const upstream = (await cli.execRead(['rev-parse', `${oldest}^`])).stdout.trim();
    await this.runWrite(repoRoot, ['rebase', '--onto', upstream, newest, 'HEAD'], options);
  }

  async getParents(repoRoot: string, sha: string): Promise<string[]> {
    const line = (await this.cli(repoRoot).execRead(['rev-list', '--parents', '-n', '1', sha])).stdout
      .trim();
    const parts = line.split(/\s+/);
    return parts.slice(1);
  }

  /**
   * Oldest first. A commit always has more ancestors than its parent, so the number of ancestors orders
   * a chain exactly; commit times do not, since commits made in the same second share one.
   */
  async orderOldestFirst(repoRoot: string, shas: string[]): Promise<string[]> {
    const unique = [...new Set(shas)];
    const cli = this.cli(repoRoot);
    // Every commit is measured independently, so measure them all at once.
    const ranked = await Promise.all(
      unique.map(async (sha) => {
        const [count, time] = await Promise.all([
          cli.execRead(['rev-list', '--count', sha]),
          cli.execRead(['show', '-s', '--format=%ct', sha]),
        ]);
        return {
          sha,
          ancestors: Number.parseInt(count.stdout.trim(), 10) || 0,
          time: Number.parseInt(time.stdout.trim(), 10) || 0,
        };
      }),
    );
    ranked.sort((a, b) => a.ancestors - b.ancestors || a.time - b.time);
    return ranked.map((entry) => entry.sha);
  }

  private async assertContiguousOnHead(repoRoot: string, ordered: string[]): Promise<void> {
    if (ordered.length < 2) {
      throw new Error(l10n.t('Select at least two contiguous commits.'));
    }
    const cli = this.cli(repoRoot);
    const head = (await cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
    const tip = ordered[ordered.length - 1];
    if (tip !== head) {
      throw new Error(l10n.t('The newest selected commit must be HEAD.'));
    }
    for (let i = 0; i < ordered.length - 1; i++) {
      const parent = (await cli.execRead(['rev-parse', `${ordered[i + 1]}^`])).stdout.trim();
      if (parent !== ordered[i]) {
        throw new Error(l10n.t('Selected commits must be contiguous.'));
      }
    }
  }

  private cli(repoRoot: string) {
    return this.cliRegistry.getOrCreate(repoRoot);
  }

  private async runWrite(
    repoRoot: string,
    args: string[],
    options?: HistoryRunOptions,
  ): Promise<void> {
    const execOpts = this.execOptions(options?.cancellationToken);
    await this.cliRegistry.runWrite(repoRoot, async () => {
      await this.cliRegistry.getOrCreate(repoRoot).execWrite(args, execOpts);
    });
  }

  private execOptions(token?: vscode.CancellationToken): GitExecOptions {
    return {
      cancellationToken: token,
      showErrorToast: true,
    };
  }
}
