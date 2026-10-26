import type * as vscode from 'vscode';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import type { GitExtensionService } from '../../core/gitExtensionService';
import { parseRevListLeftRightCount } from '../../core/gitRefParser';
import type { Repository } from '../../core/vscodeGitApi';
import type { SyncStatusDto } from '../../shared/sync/syncProtocol';
import type { GitExecOptions } from '../../core/gitCli';
import { withLeanStash } from '../branches/leanBranching';
import { fetchCliArgs } from './fetchOptions';
import { pullCliArgs, pullIntoArgs, splitUpstream } from './pullOptions';
import { pushCliArgs } from './pushOptions';
import type { WorkingTreeService } from '../changes/workingTreeService';
import {
  defaultGitCheckoutSettings,
  type GitCheckoutSettingsReader,
} from '../../core/gitCheckoutSettings';
import { createLogger } from '../../log';
import * as l10n from '@vscode/l10n';
import { RepositoryNotOpenError } from '../../core/repositoryNotOpenError';

const log = createLogger('sync');

export interface SyncRunOptions {
  cancellationToken?: vscode.CancellationToken;
}

export interface FetchOptions extends SyncRunOptions {
  remote?: string;
  /** Fetch every configured remote instead of `remote`. */
  all?: boolean;
}

export interface PushOptions extends SyncRunOptions {
  setUpstream?: boolean;
  forceWithLease?: boolean;
  remote?: string;
  branch?: string;
  tags?: boolean;
}

export interface PullOptions extends SyncRunOptions {
  remote?: string;
  branch?: string;
  rebase?: boolean;
  /** Stash local changes before pull and pop afterward. Defaults to the lean-branching setting. */
  stash?: boolean;
  /** A local branch other than the checked-out one to fast-forward from the remote branch. */
  into?: string;
}

export class RemoteSyncService {
  constructor(
    private readonly gitService: GitExtensionService,
    private readonly cliRegistry: GitCliRegistry,
    private readonly workingTree: WorkingTreeService,
    private readonly settings: GitCheckoutSettingsReader = defaultGitCheckoutSettings,
  ) {}

  findRepository(repoRoot: string): Repository | undefined {
    return this.gitService.getRepositories().find((r) => r.rootUri.fsPath === repoRoot);
  }

  async getSyncStatus(repoRoot: string, busy: boolean): Promise<SyncStatusDto> {
    const repo = this.findRepository(repoRoot);
    if (!repo) {
      return { ahead: null, behind: null, upstream: null, busy };
    }

    const head = repo.state.HEAD;
    const upstream = head?.upstream?.name ?? null;
    let ahead = head?.ahead !== undefined ? head.ahead : null;
    let behind = head?.behind !== undefined ? head.behind : null;

    if (upstream && (head?.ahead === undefined || head?.behind === undefined)) {
      try {
        const cli = this.cliRegistry.forRepository(repo);
        const result = await cli.execRead([
          'rev-list',
          '--left-right',
          '--count',
          `${upstream}...HEAD`,
        ]);
        const { left, right } = parseRevListLeftRightCount(result.stdout);
        behind = left;
        ahead = right;
      } catch (error) {
        log.debug(`could not compute ahead/behind against ${upstream}`, error);
      }
    }

    return { ahead, behind, upstream, busy };
  }

  async fetch(repoRoot: string, options?: FetchOptions): Promise<void> {
    const repo = this.requireRepository(repoRoot);
    const execOpts = this.execOptions(options?.cancellationToken);
    const choices = { remote: options?.remote ?? '', all: options?.all === true };
    const tags = this.settings.fetchIncludeTags();
    if (choices.all || choices.remote || tags) {
      // `--tags` has no place in the vscode.git fetch, so a fetch that asks for every tag goes through Git itself.
      const args = choices.all || choices.remote ? fetchCliArgs(choices) : ['fetch'];
      if (tags) {
        args.splice(1, 0, '--tags');
      }
      log.info(`${args.join(' ')} in ${repoRoot}`);
      if (choices.all || tags) {
        await this.cliRegistry.getOrCreate(repoRoot).execWrite(args, { ...execOpts, network: true });
        return;
      }
      await this.runApiOrCli(repoRoot, () => repo.fetch({ remote: choices.remote }), args, execOpts);
      return;
    }
    log.info(`fetch in ${repoRoot}`);
    await this.runApiOrCli(repoRoot, () => repo.fetch(), ['fetch'], execOpts);
  }

  async pull(repoRoot: string, options?: PullOptions): Promise<void> {
    const repo = this.requireRepository(repoRoot);
    const execOpts = this.execOptions(options?.cancellationToken);
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    if (options?.into && options.into !== repo.state.HEAD?.name) {
      // Another branch cannot be pulled into the working tree; fast-forward it from the remote branch.
      const remote = options.remote ?? 'origin';
      const branch = options.branch ?? options.into;
      log.info(`pull ${remote}/${branch} into ${options.into} in ${repoRoot}`);
      await cli.execWrite(pullIntoArgs({ remote, branch, into: options.into }), { ...execOpts, network: true });
      return;
    }
    const stash = options?.stash ?? this.settings.leanBranchingStashOnSwitch();
    const explicit =
      options?.remote !== undefined ||
      options?.branch !== undefined ||
      options?.rebase !== undefined;
    const target = explicit ? this.resolvePullTarget(repo, options) : undefined;
    log.info(
      target
        ? `pull ${target.remote}/${target.branch} in ${repoRoot}${target.rebase ? ' (rebase)' : ''}${stash ? ' (stash)' : ''}`
        : `pull in ${repoRoot}`,
    );
    await withLeanStash(repoRoot, stash, this.workingTree, cli, async () => {
      if (!target) {
        await this.runApiOrCli(repoRoot, () => repo.pull(), ['pull'], execOpts);
        return;
      }
      await cli.execWrite(pullCliArgs(target), { ...execOpts, network: true });
    });
  }

  async push(repoRoot: string, options?: PushOptions): Promise<void> {
    const repo = this.requireRepository(repoRoot);
    const execOpts = this.execOptions(options?.cancellationToken);
    const skipHooks = this.settings.gitSkipHooks();
    const forceWithLease = options?.forceWithLease ?? false;
    const setUpstream = options?.setUpstream ?? false;
    const tags = options?.tags ?? false;

    const headName = repo.state.HEAD?.name;
    const upstream = repo.state.HEAD?.upstream?.name;
    let remoteName: string | undefined;
    let branchName = headName;
    if (upstream) {
      const slash = upstream.indexOf('/');
      if (slash > 0) {
        remoteName = upstream.slice(0, slash);
        branchName = upstream.slice(slash + 1);
      }
    } else if (setUpstream) {
      remoteName = 'origin';
    }
    if (options?.remote) {
      remoteName = options.remote;
    }
    if (options?.branch) {
      branchName = options.branch;
    }
    if (!branchName) {
      throw new Error(l10n.t('No branch checked out.'));
    }

    const cliParams = {
      remoteName,
      branchName,
      setUpstream,
      forceWithLease,
      skipHooks,
      tags,
    };

    const target = remoteName ? `${remoteName}/${branchName}` : branchName;
    log.info(
      `push ${target} in ${repoRoot}${forceWithLease ? ' (force-with-lease)' : ''}${tags ? ' (tags)' : ''}`,
    );
    // execWrite already takes the repo write lock. Wrapping it in runWrite deadlocks the queue.
    if (skipHooks || forceWithLease || tags) {
      await this.pushViaCli(repoRoot, execOpts, cliParams);
      return;
    }
    try {
      await this.cliRegistry.runWrite(repoRoot, () => repo.push(remoteName, branchName, setUpstream));
    } catch (error) {
      log.warn('vscode.git push failed; falling back to CLI', error);
      await this.pushViaCli(repoRoot, execOpts, {
        ...cliParams,
        forceWithLease: false,
        skipHooks: false,
        tags: false,
      });
    }
  }

  async setUpstream(
    repoRoot: string,
    branch: string,
    upstreamRef: string,
    options?: SyncRunOptions,
  ): Promise<void> {
    this.requireRepository(repoRoot);
    const execOpts = this.execOptions(options?.cancellationToken);

    // execWrite already takes the repo write lock. Wrapping it in runWrite deadlocks the queue.
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    await cli.execWrite(['branch', '--set-upstream-to', upstreamRef, branch], execOpts);
  }

  async unsetUpstream(
    repoRoot: string,
    branch: string,
    options?: SyncRunOptions,
  ): Promise<void> {
    this.requireRepository(repoRoot);
    const execOpts = this.execOptions(options?.cancellationToken);
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    await cli.execWrite(['branch', '--unset-upstream', branch], execOpts);
  }

  async fastForward(
    repoRoot: string,
    branch: string,
    options?: SyncRunOptions,
  ): Promise<void> {
    const repo = this.requireRepository(repoRoot);
    const execOpts = this.execOptions(options?.cancellationToken);
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    const isHead = repo.state.HEAD?.name === branch;
    if (isHead) {
      await cli.execWrite(['merge', '--ff-only', '@{u}'], execOpts);
      return;
    }
    const upstreamRes = await cli.execRead(['rev-parse', '--abbrev-ref', `${branch}@{u}`]);
    const upstream = upstreamRes.stdout.trim();
    if (!upstream) {
      throw new Error(l10n.t('Branch {0} has no upstream configured.', branch));
    }
    await cli.execWrite(['fetch', '.', `${upstream}:${branch}`], execOpts);
  }

  private async runApiOrCli(
    repoRoot: string,
    apiOp: () => Promise<void>,
    cliArgs: string[],
    execOpts: GitExecOptions,
  ): Promise<void> {
    try {
      await this.cliRegistry.runWrite(repoRoot, () => apiOp());
    } catch (error) {
      log.warn(`vscode.git ${cliArgs[0]} failed; falling back to CLI`, error);
      await this.cliRegistry.getOrCreate(repoRoot).execWrite(cliArgs, {
        ...execOpts,
        network: true,
      });
    }
  }

  private async pushViaCli(
    repoRoot: string,
    execOpts: GitExecOptions,
    params: {
      remoteName?: string;
      branchName: string;
      setUpstream: boolean;
      forceWithLease: boolean;
      skipHooks: boolean;
      tags: boolean;
    },
  ): Promise<void> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    await cli.execWrite(pushCliArgs(params), { ...execOpts, network: true });
  }

  private resolvePullTarget(
    repo: Repository,
    options: PullOptions | undefined,
  ): { remote: string; branch: string; rebase: boolean } {
    const upstream = splitUpstream(repo.state.HEAD?.upstream?.name ?? null);
    const remote = options?.remote ?? upstream.remote ?? 'origin';
    const branch =
      options?.branch ??
      (upstream.remote === remote ? upstream.branch : null) ??
      repo.state.HEAD?.name ??
      'HEAD';
    return { remote, branch, rebase: options?.rebase ?? false };
  }

  private execOptions(token?: vscode.CancellationToken): GitExecOptions {
    return {
      cancellationToken: token,
      timeoutMs: this.settings.networkTimeoutMs(),
      showErrorToast: true,
    };
  }

  private requireRepository(repoRoot: string): Repository {
    const repo = this.findRepository(repoRoot);
    if (!repo) {
      throw new RepositoryNotOpenError();
    }
    return repo;
  }
}
