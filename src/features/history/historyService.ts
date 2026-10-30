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

/** What the Edit Commit Message form shows about a commit. */
export interface CommitMessageInfo {
  message: string;
  subject: string;
  /** Remote-tracking branches that already have the commit: editing it means a force push. */
  pushedTo: string[];
  /** Why the commit cannot be edited, when it cannot. */
  problem?: string;
}

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

  /**
   * What the Edit Commit Message form needs: the whole message, and why the commit cannot be edited when it cannot.
   * Only a commit of the checked-out branch can change, and rewriting through a merge commit would flatten it.
   */
  async commitMessageInfo(repoRoot: string, sha: string): Promise<CommitMessageInfo> {
    const cli = this.cli(repoRoot);
    const message = (await cli.execRead(['show', '-s', '--format=%B', sha, '--'])).stdout.replace(/\s+$/, '');
    const subject = message.split('\n', 1)[0] ?? '';
    const onBranch = await cli.execRead(['merge-base', '--is-ancestor', sha, 'HEAD'], { showErrorToast: false }).then(
      () => true,
      (error: unknown) => {
        // Exit status 1 means "not an ancestor", which is the answer rather than a failure.
        log.debug('commit is not on the checked-out branch', error);
        return false;
      },
    );
    if (!onBranch) {
      return { message, subject, pushedTo: [], problem: l10n.t('Only a commit of the checked-out branch can be edited. Check out the branch that has it first.') };
    }
    const parents = await this.getParents(repoRoot, sha);
    const merges = (await cli.execRead(['rev-list', '--merges', '--count', 'HEAD', '--not', ...parents])).stdout.trim();
    if (merges !== '0') {
      return { message, subject, pushedTo: [], problem: l10n.t('This commit is followed by a merge commit, which editing would flatten. Use Interactive Rebase instead.') };
    }
    const remotes = (await cli.execRead(['branch', '-r', '--contains', sha, '--format=%(refname:short)'])).stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.endsWith('/HEAD'));
    return { message, subject, pushedTo: remotes };
  }

  /**
   * Gives a commit of the checked-out branch a new message and replays the commits after it on top, with the same
   * trees, so nothing can conflict. The last commit is amended with only its message, whatever is staged. Other
   * branches that contain the commit keep the old one.
   */
  async rewordCommit(repoRoot: string, sha: string, message: string, options?: HistoryRunOptions): Promise<void> {
    if (!message.trim() || message.includes('\0')) {
      throw new Error(l10n.t('Enter a non-empty commit message without null characters.'));
    }
    const cli = this.cli(repoRoot);
    const head = (await cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
    const full = (await cli.execRead(['rev-parse', sha])).stdout.trim();
    if (full === head) {
      const args = ['commit', '--amend', '--only', '--allow-empty', '-m', message];
      if (this.settings.gitSkipHooks()) {
        args.push('--no-verify');
      }
      await this.runWrite(repoRoot, args, options);
      return;
    }
    const [author, parents] = await Promise.all([
      cli.execRead(['show', '-s', '--format=%an%x00%ae%x00%aI', full, '--']),
      this.getParents(repoRoot, full),
    ]);
    const [name, email, date] = author.stdout.trim().split('\0');
    // execWriteWithInput takes the repository's write lock itself.
    const created = await cli.execWriteWithInput(
      ['commit-tree', `${full}^{tree}`, ...parents.flatMap((parent) => ['-p', parent])],
      message.endsWith('\n') ? message : `${message}\n`,
      { env: { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_AUTHOR_DATE: date }, cancellationToken: options?.cancellationToken },
    );
    await this.runWrite(repoRoot, ['rebase', '--autostash', '--onto', created.stdout.trim(), full], options);
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
