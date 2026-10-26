import type * as vscode from 'vscode';
import type { GitCli } from '../../core/gitCli';
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

const log = createLogger('integrate');

export interface IntegrateRunOptions {
  cancellationToken?: vscode.CancellationToken;
}

export interface RebaseOptions extends IntegrateRunOptions {
  updateRefs?: boolean;
  stashDirty?: boolean;
}

export type MergeMode = 'default' | 'fastForward';

export class IntegrationService {
  constructor(
    private readonly gitService: GitExtensionService,
    private readonly cliRegistry: GitCliRegistry,
    private readonly workingTree: WorkingTreeService,
    private readonly settings: GitCheckoutSettingsReader = defaultGitCheckoutSettings,
  ) {}

  async merge(
    repoRoot: string,
    ref: string,
    options?: IntegrateRunOptions & { mergeMode?: MergeMode },
  ): Promise<void> {
    await this.integrate(repoRoot, options, async (repo, cli, execOpts) => {
      if (options?.mergeMode !== 'fastForward' && typeof repo.merge === 'function') {
        try {
          log.info(`merge ${ref}`);
          await repo.merge(ref);
          return;
        } catch (error) {
          log.warn('vscode.git merge failed; falling back to CLI', error);
        }
      }
      await cli.execWrite(
        ['merge', ...(options?.mergeMode === 'fastForward' ? ['--ff'] : []), ref],
        execOpts,
      );
    });
  }

  async rebase(repoRoot: string, onto: string, options?: RebaseOptions): Promise<void> {
    await this.integrate(repoRoot, options, async (repo, cli, execOpts) => {
      if (!options?.updateRefs && typeof repo.rebase === 'function') {
        try {
          log.info(`rebase onto ${onto}`);
          await repo.rebase(onto);
          return;
        } catch (error) {
          log.warn('vscode.git rebase failed; falling back to CLI', error);
        }
      }
      await cli.execWrite(['rebase', ...(options?.updateRefs ? ['--update-refs'] : []), onto], execOpts);
    }, options?.stashDirty);
  }

  private async integrate(
    repoRoot: string,
    options: IntegrateRunOptions | undefined,
    op: (repo: Repository, cli: GitCli, execOpts: GitExecOptions) => Promise<void>,
    stashDirty?: boolean,
  ): Promise<void> {
    const lean = stashDirty ?? this.settings.leanBranchingStashOnSwitch();
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    const execOpts = this.execOptions(options?.cancellationToken);

    await withLeanStash(repoRoot, lean, this.workingTree, cli, async () => {
      await this.cliRegistry.runWrite(repoRoot, async () => {
        const repo = this.requireRepository(repoRoot);
        await op(repo, cli, execOpts);
      });
    });
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
