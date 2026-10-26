import type * as vscode from 'vscode';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import type { GitExtensionService } from '../../core/gitExtensionService';
import type { Repository } from '../../core/vscodeGitApi';
import type { GitExecOptions } from '../../core/gitCli';
import { withLeanStash } from './leanBranching';
import type { WorkingTreeService } from '../changes/workingTreeService';
import {
  defaultGitCheckoutSettings,
  type GitCheckoutSettingsReader,
} from '../../core/gitCheckoutSettings';
import { createLogger } from '../../log';
import { RepositoryNotOpenError } from '../../core/repositoryNotOpenError';

const log = createLogger('checkout');

export interface CheckoutOptions {
  cancellationToken?: vscode.CancellationToken;
  fastForward?: boolean;
  /** Skip the remote-tracking heuristic so `feature/foo` checks out that local branch. */
  localBranch?: boolean;
  /** Checkout a commit without moving the current branch. */
  detach?: boolean;
}

export interface FastForwardOffer {
  localBranch: string;
  remoteRef: string;
}

export class CheckoutService {
  constructor(
    private readonly gitService: GitExtensionService,
    private readonly cliRegistry: GitCliRegistry,
    private readonly workingTree: WorkingTreeService,
    private readonly settings: GitCheckoutSettingsReader = defaultGitCheckoutSettings,
  ) {}

  async detectFastForward(repoRoot: string, ref: string): Promise<FastForwardOffer | null> {
    const remoteMatch = /^([^/]+)\/(.+)$/.exec(ref);
    if (!remoteMatch) {
      return null;
    }
    const remoteRef = ref;
    const localBranch = remoteMatch[2];
    const cli = this.cliRegistry.getOrCreate(repoRoot);

    try {
      await cli.execRead(['show-ref', '--verify', `refs/heads/${localBranch}`]);
    } catch (error) {
      log.debug(`could not probe local branch ${localBranch}`, error);
      return null;
    }

    try {
      await cli.execRead(['merge-base', '--is-ancestor', localBranch, remoteRef]);
    } catch (error) {
      log.debug(`could not check whether ${localBranch} can fast-forward to ${remoteRef}`, error);
      return null;
    }

    const localSha = (await cli.execRead(['rev-parse', localBranch])).stdout.trim();
    const remoteSha = (await cli.execRead(['rev-parse', remoteRef])).stdout.trim();
    if (localSha === remoteSha) {
      return null;
    }

    return { localBranch, remoteRef };
  }

  async checkout(repoRoot: string, ref: string, options?: CheckoutOptions): Promise<string> {
    const repo = this.requireRepository(repoRoot);
    const execOpts = this.execOptions(options?.cancellationToken);
    const lean = this.settings.leanBranchingStashOnSwitch();
    const cli = this.cliRegistry.getOrCreate(repoRoot);

    log.info(`checkout ${ref} in ${repoRoot}`);
    let filterRef = ref;

    // execRead and execWrite already use the repo queue. Wrapping them in runWrite deadlocks it.
    await withLeanStash(repoRoot, lean, this.workingTree, cli, async () => {
      if (options?.detach) {
        await cli.execWrite(['checkout', '--detach', ref], execOpts);
        filterRef = ref;
        return;
      }

      if (options?.fastForward) {
        const offer = await this.detectFastForward(repoRoot, ref);
        if (offer) {
          await cli.execWrite(['checkout', offer.localBranch], execOpts);
          await cli.execWrite(['merge', '--ff-only', offer.remoteRef], execOpts);
          filterRef = offer.localBranch;
          return;
        }
      }

      const remoteMatch = options?.localBranch ? null : /^([^/]+)\/(.+)$/.exec(ref);
      if (remoteMatch && !options?.fastForward) {
        const localBranch = remoteMatch[2];
        try {
          await cli.execRead(['show-ref', '--verify', `refs/heads/${localBranch}`]);
          await cli.execWrite(['checkout', localBranch], execOpts);
          filterRef = localBranch;
          return;
        } catch (error) {
          log.debug(`could not Checkout local branch ${localBranch}; creating a tracking branch`, error);
          await cli.execWrite(['switch', '-c', localBranch, '--track', ref], execOpts);
          filterRef = localBranch;
          return;
        }
      }

      try {
        await repo.checkout(ref);
      } catch (error) {
        log.warn(`vscode.git checkout of ${ref} failed; falling back to CLI`, error);
        try {
          await cli.execWrite(['switch', ref], execOpts);
        } catch (error) {
          log.warn(`git switch failed for ${ref}; falling back to git checkout`, error);
          await cli.execWrite(['checkout', ref], execOpts);
        }
      }

      if (remoteMatch) {
        filterRef = remoteMatch[2];
      } else if (!ref.includes('/')) {
        filterRef = ref;
      }
    });

    return filterRef;
  }

  private execOptions(token?: vscode.CancellationToken): GitExecOptions {
    return {
      cancellationToken: token,
      showErrorToast: true,
    };
  }

  private requireRepository(repoRoot: string): Repository {
    const repo = this.gitService.getRepositories().find((r) => r.rootUri.fsPath === repoRoot);
    if (!repo) {
      throw new RepositoryNotOpenError();
    }
    return repo;
  }
}
