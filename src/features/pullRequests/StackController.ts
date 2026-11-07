import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import { createLogger } from '../../log';
import type { GitHubRepository } from '../../shared/history/githubReferences';
import type { PullRequestChain } from '../../shared/pullRequests/pullRequestStacks';
import { locateLayer } from '../../shared/pullRequests/stackNavigation';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';
import { PULL_REQUEST_COMMANDS } from '../../ui/pullRequestNodes';
import type { SidebarNode } from '../../ui/sidebarTreeModel';
import type { PullRequestStore } from './PullRequestStore';
import { findBaseBranch } from './branchChanges';
import { addToStack, createStack, GitHubRestError, listStacks } from './githubRestClient';
import { pushStackArgs, pushStackForm, rebaseStackForm, stackLinkFor, syncStackForm, validatePushStackForm } from './stackGit';
import { rebaseStack } from './stackRebase';
import { baseBranchName } from './stackCommits';

const log = createLogger('stack');

type Window = Pick<GitCheckoutPanelManager, 'operationForm' | 'activeRepoRoot' | 'selectRepository' | '_onDidChangeRefs' | 'sync' | 'repoOperationService'>;

/** A stack of pull requests, and the repository and remote it is in. */
interface ResolvedStack {
  root: string;
  chain: PullRequestChain;
  remote: string;
  repo: GitHubRepository;
}

/** What is done to a whole stack: push it, rebase it, sync it, merge it, take it apart. */
export class StackController {
  constructor(
    private readonly store: PullRequestStore,
    private readonly cliRegistry: GitCliRegistry,
    private readonly window: Window,
  ) {}

  register(context: vscode.ExtensionContext): void {
    const C = PULL_REQUEST_COMMANDS;
    context.subscriptions.push(
      vscode.commands.registerCommand(C.pushStack, (node?: SidebarNode) => this.pushStack(node)),
      vscode.commands.registerCommand(C.rebaseStack, (node?: SidebarNode) => this.rebaseStack(node)),
      vscode.commands.registerCommand(C.syncStack, (node?: SidebarNode) => this.syncStack(node)),
    );
  }

  /** The stack that was right-clicked, or the checked-out branch's. Says why when there is none. */
  private async resolve(node: SidebarNode | undefined): Promise<ResolvedStack | undefined> {
    const root = node?.repoRoot ?? this.window.activeRepoRoot();
    const stacks = root ? this.store.stacks(root) : undefined;
    if (!root || !stacks) {
      void vscode.window.showInformationMessage(l10n.t('The pull requests of this repository are not loaded.'));
      return undefined;
    }
    let chain: PullRequestChain | undefined;
    if (node?.ref) {
      chain = stacks.chains.find((entry) => String(entry.pulls[0].number) === node.ref);
    } else {
      const current = (await this.cliRegistry.getOrCreate(root).execRead(['branch', '--show-current'])).stdout.trim();
      chain = locateLayer(stacks.chains, current)?.chain;
      if (!chain) {
        void vscode.window.showInformationMessage(l10n.t("'{0}' is not in a stack of pull requests.", current));
        return undefined;
      }
    }
    return chain && { root, chain, remote: stacks.remote, repo: stacks.repo };
  }

  private async branchNames(root: string): Promise<string[]> {
    return (await this.cliRegistry.getOrCreate(root).execRead(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).stdout.split('\n').filter(Boolean);
  }

  /** The local branches of a stack's layers, bottom first; a layer nobody has checked out here has none. */
  private async localBranches(root: string, chain: PullRequestChain): Promise<string[]> {
    const names = await this.branchNames(root);
    return chain.pulls.map((pull) => pull.headRef).filter((branch) => names.includes(branch));
  }

  /** Opens the form to push the stack's local branches in one push, to replace the ones that were rebased. */
  private async pushStack(node?: SidebarNode): Promise<void> {
    const stack = await this.resolve(node);
    if (!stack) {
      return;
    }
    const git = this.cliRegistry.getOrCreate(stack.root);
    const branches = await this.localBranches(stack.root, stack.chain);
    if (branches.length === 0) {
      void vscode.window.showInformationMessage(l10n.t('None of the branches of this stack is checked out here.'));
      return;
    }
    const remotes = (await git.execRead(['remote'])).stdout.split('\n').filter(Boolean);
    if (remotes.length === 0) {
      void vscode.window.showWarningMessage(l10n.t('No remotes are configured.'));
      return;
    }
    await this.window.selectRepository(stack.root);
    await this.window.operationForm.show(pushStackForm(branches, remotes, remotes.includes(stack.remote) ? stack.remote : remotes[0]), {
      validate: (values) => validatePushStackForm(remotes, values),
      submit: async (values) => {
        log.info(`pushing ${branches.length} branches of a stack`);
        await git.execWrite(pushStackArgs(String(values.remote), branches, values.force === true), { network: true });
        this.window._onDidChangeRefs.fire();
        void vscode.window.showInformationMessage(branches.length === 1 ? l10n.t('Pushed 1 branch.') : l10n.t('Pushed {0} branches.', branches.length));
        return true;
      },
    });
  }

  /** What a rebase of the stack needs: its local branches, the base branch, and a merged parent still here. Says why when it cannot be done. */
  private async prepareRebase(stack: ResolvedStack): Promise<{ branches: string[]; trunk: string; mergedParent?: string } | undefined> {
    const git = this.cliRegistry.getOrCreate(stack.root);
    const branches = await this.localBranches(stack.root, stack.chain);
    const missing = stack.chain.pulls.filter((pull) => !branches.includes(pull.headRef)).map((pull) => pull.headRef);
    if (missing.length > 0) {
      void vscode.window.showInformationMessage(l10n.t('Check out these layers first, to rebase the stack: {0}.', missing.join(', ')));
      return undefined;
    }
    const trunk = await findBaseBranch(git, branches[0]);
    if (!trunk) {
      void vscode.window.showInformationMessage(l10n.t("Could not find the branch that '{0}' would merge into.", branches[0]));
      return undefined;
    }
    // A bottom pull request that still targets a branch other than the trunk is built on a parent that was merged.
    const bottomBase = stack.chain.pulls[0].baseRef;
    const mergedParent = bottomBase !== baseBranchName(trunk, stack.remote) && (await this.branchNames(stack.root)).includes(bottomBase) ? bottomBase : undefined;
    return { branches, trunk, mergedParent };
  }

  /** Fetches when asked, then moves the layers onto their parents and puts the person back on their branch. Gives the number of branches that moved. */
  private async rebaseLayers(stack: ResolvedStack, plan: { branches: string[]; trunk: string; mergedParent?: string }, fetch: boolean): Promise<number> {
    const git = this.cliRegistry.getOrCreate(stack.root);
    if (fetch) {
      await git.execWrite(['fetch', stack.remote], { network: true, concurrent: true });
    }
    const original = (await git.execRead(['branch', '--show-current'])).stdout.trim();
    let steps;
    try {
      steps = await rebaseStack(git, plan);
    } catch (error) {
      if ((await this.window.repoOperationService.getStatus(stack.root)).active) {
        void vscode.window.showInformationMessage(l10n.t('The rebase stopped for conflicts. Resolve them and continue the rebase, then rebase the stack again to carry on with the branches above.'));
      }
      throw error;
    }
    // Each rebase checks its branch out; the person is put back where they were.
    if (original && (await git.execRead(['branch', '--show-current'])).stdout.trim() !== original) {
      await git.execWrite(['switch', original]);
    }
    return steps.filter((step) => step.moved).length;
  }

  /**
   * Opens the form to move the stack's layers onto their parents: the bottom onto the base branch, the others onto the layer
   * below. A stopped rebase is finished like any other, and running this again carries on with the layers above.
   */
  private async rebaseStack(node?: SidebarNode): Promise<void> {
    const stack = await this.resolve(node);
    const plan = stack && (await this.prepareRebase(stack));
    if (!stack || !plan) {
      return;
    }
    await this.window.selectRepository(stack.root);
    await this.window.operationForm.show(rebaseStackForm(plan.branches, plan.trunk), {
      validate: () => ({}),
      submit: async (values) => {
        await this.window.sync.runSyncOp(l10n.t('Rebasing stack'), async () => {
          const moved = await this.rebaseLayers(stack, plan, values.fetch === true);
          void vscode.window.showInformationMessage(moved === 0 ? l10n.t('The stack is up to date.') : moved === 1 ? l10n.t('Rebased 1 branch.') : l10n.t('Rebased {0} branches.', moved));
        });
        return true;
      },
    });
  }

  /**
   * Opens the form to bring the stack up to date in one go: fetch, rebase onto the base branch, push, and make the stack on
   * GitHub the same as the chain of pull requests.
   */
  private async syncStack(node?: SidebarNode): Promise<void> {
    const stack = await this.resolve(node);
    const plan = stack && (await this.prepareRebase(stack));
    if (!stack || !plan) {
      return;
    }
    const git = this.cliRegistry.getOrCreate(stack.root);
    await this.window.selectRepository(stack.root);
    await this.window.operationForm.show(syncStackForm(plan.branches, plan.trunk), {
      validate: () => ({}),
      submit: async (values) => {
        await this.window.sync.runSyncOp(l10n.t('Syncing stack'), async () => {
          const results: string[] = [];
          const moved = await this.rebaseLayers(stack, plan, true);
          results.push(moved === 0 ? l10n.t('The stack was up to date.') : moved === 1 ? l10n.t('Rebased 1 branch.') : l10n.t('Rebased {0} branches.', moved));
          if (values.push === true) {
            await git.execWrite(pushStackArgs(stack.remote, plan.branches, true), { network: true });
            results.push(plan.branches.length === 1 ? l10n.t('Pushed 1 branch.') : l10n.t('Pushed {0} branches.', plan.branches.length));
          }
          if (values.link === true) {
            results.push(await this.linkStack(stack));
          }
          this.store.refresh();
          this.window._onDidChangeRefs.fire();
          void vscode.window.showInformationMessage(results.join(' '));
        });
        return true;
      },
    });
  }

  /** Makes the stack on GitHub the chain of pull requests, when it is not; gives a sentence for what was done or why not. */
  private async linkStack(stack: ResolvedStack): Promise<string> {
    const { repo } = stack;
    const access = await this.store.writeAccess();
    if (!access) {
      return l10n.t('Not grouped as a stack: sign in to GitHub to do that.');
    }
    const numbers = stack.chain.pulls.map((pull) => pull.number);
    try {
      const link = stackLinkFor(await listStacks(repo, access.token, access.transport), numbers);
      switch (link.kind) {
        case 'linked':
          return l10n.t('The pull requests are one stack on GitHub.');
        case 'create':
          await createStack(repo, access.token, link.pullRequests, access.transport);
          return l10n.t('Grouped the pull requests as a stack on GitHub.');
        case 'add':
          await addToStack(repo, access.token, link.stack, link.pullRequests, access.transport);
          return l10n.t('Added {0} pull requests to the stack on GitHub.', link.pullRequests.length);
        case 'differs':
          return l10n.t('The stack on GitHub is not the same as these pull requests, so it was left alone.');
      }
    } catch (error) {
      if (!(error instanceof GitHubRestError)) {
        throw error;
      }
      // The branches are pushed and rebased; only the grouping is missing, which the person is told.
      log.warn('could not make the stack on GitHub match', error);
      return l10n.t('Not grouped as a stack: {0}', error.message);
    }
  }
}
