import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import { loadGitHubRemote } from '../../core/githubRepository';
import { createLogger } from '../../log';
import { canonicalGitHubIssueUrl } from '../../shared/history/githubReferences';
import type { PullRequestDto } from '../../shared/pullRequests/pullRequests';
import type { PullRequestChain } from '../../shared/pullRequests/pullRequestStacks';
import { locateLayer, moveInStack, type StackMove } from '../../shared/pullRequests/stackNavigation';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';
import { PULL_REQUEST_COMMANDS } from '../../ui/pullRequestNodes';
import type { SidebarNode } from '../../ui/sidebarTreeModel';
import { fetchPullRequestBase, fetchPullRequestHead, preparePullRequestBranch, resetPullRequestBranch } from './pullRequestCheckout';
import { GitHubRestError } from './githubRestClient';
import type { PullRequestStore } from './PullRequestStore';
import { stackForm, stackPlanFromValues, validateStackForm, type StackFormContext } from './pullRequestStackForm';
import { baseBranchName, loadStackCommits, MAX_STACK_COMMITS } from './stackCommits';
import { createPullRequests } from './stackPullRequests';

const log = createLogger('pull-requests');

type Window = Pick<GitCheckoutPanelManager, 'selectRepository' | 'runCheckout' | 'runCheckoutAsWorktree' | 'showCommitRange' | 'sync' | 'operationForm' | 'activeRepoRoot'>;

/** What the Pull Requests rows do: check a pull request out, in this folder or in a worktree, open it on GitHub, read the list again. */
export class PullRequestController {
  constructor(
    private readonly store: PullRequestStore,
    private readonly cliRegistry: GitCliRegistry,
    private readonly window: Window,
  ) {}

  register(context: vscode.ExtensionContext): void {
    const C = PULL_REQUEST_COMMANDS;
    context.subscriptions.push(
      vscode.commands.registerCommand(C.refresh, () => this.store.refresh()),
      vscode.commands.registerCommand(C.showClosed, (node?: SidebarNode) => (node?.repoRoot ? this.store.showClosed(node.repoRoot) : undefined)),
      vscode.commands.registerCommand(C.signIn, () => this.store.signIn(false)),
      vscode.commands.registerCommand(C.grantAccess, () => this.store.signIn(true)),
      vscode.commands.registerCommand(C.checkout, (node?: SidebarNode) => this.checkout(node, false)),
      vscode.commands.registerCommand(C.checkoutInWorktree, (node?: SidebarNode) => this.checkout(node, true)),
      vscode.commands.registerCommand(C.review, (node?: SidebarNode) => this.review(node)),
      vscode.commands.registerCommand(C.openOnGitHub, (node?: SidebarNode) => this.openOnGitHub(node)),
      vscode.commands.registerCommand(C.copyLink, (node?: SidebarNode) => this.copyLink(node)),
      vscode.commands.registerCommand(C.createStack, (target?: { ref?: string; repoRoot?: string }) => this.createStack(target)),
      vscode.commands.registerCommand(C.checkoutStack, (node?: SidebarNode) => this.pickLayer(node)),
      vscode.commands.registerCommand(C.stackUp, () => this.moveInStack('up')),
      vscode.commands.registerCommand(C.stackDown, () => this.moveInStack('down')),
      vscode.commands.registerCommand(C.stackTop, () => this.moveInStack('top')),
      vscode.commands.registerCommand(C.stackBottom, () => this.moveInStack('bottom')),
    );
  }

  private find(node: SidebarNode | undefined) {
    const found = node?.repoRoot && node.ref ? this.store.find(node.repoRoot, Number(node.ref)) : undefined;
    return found && node?.repoRoot ? { ...found, repoRoot: node.repoRoot } : undefined;
  }

  /** The address of a pull request, if it is one GitHub serves for this repository. */
  private link(node: SidebarNode | undefined): string | undefined {
    const found = this.find(node);
    return found ? (canonicalGitHubIssueUrl(found.pull.url, found.repo) ?? undefined) : undefined;
  }

  private async openOnGitHub(node?: SidebarNode): Promise<void> {
    const url = this.link(node);
    if (url && !(await vscode.env.openExternal(vscode.Uri.parse(url)))) {
      void vscode.window.showWarningMessage(l10n.t('Could not open the GitHub link.'));
    }
  }

  private async copyLink(node?: SidebarNode): Promise<void> {
    const url = this.link(node);
    if (url) {
      await vscode.env.clipboard.writeText(url);
      void vscode.window.setStatusBarMessage(l10n.t('Copied the GitHub link'), 3000);
    }
  }

  /** Gets the pull request and its target branch, then shows what the pull request changes in the Commit tab, without touching any branch. */
  private async review(node?: SidebarNode): Promise<void> {
    const found = this.find(node);
    if (!found) {
      return;
    }
    const { pull, remote, repoRoot } = found;
    await this.window.selectRepository(repoRoot);
    let range: { base: string; head: string } | undefined;
    await this.window.sync.runSyncOp(l10n.t('Getting pull request #{0}', pull.number), async (root) => {
      const git = this.cliRegistry.getOrCreate(root);
      const head = await fetchPullRequestHead(git, remote, pull.number);
      const base = await fetchPullRequestBase(git, remote, pull.baseRef);
      // What the pull request changes is measured from where it left the target branch, not from the target's tip.
      range = { base: (await git.execRead(['merge-base', base, head])).stdout.trim(), head };
    });
    if (range) {
      await this.window.showCommitRange(range.base, range.head);
    }
  }

  /**
   * Gets the pull request's head onto the branch `pr/<n>` in the same way as other long operations (progress, the check for
   * a merge or rebase in progress, errors), asking before a branch with commits of its own is moved. Undefined when the
   * person says no.
   */
  private async prepareBranch(pull: PullRequestDto, remote: string): Promise<string | undefined> {
    let branch: string | undefined;
    await this.window.sync.runSyncOp(l10n.t('Getting pull request #{0}', pull.number), async (root) => {
      const git = this.cliRegistry.getOrCreate(root);
      const prepared = await preparePullRequestBranch(git, remote, pull.number);
      if (prepared.kind === 'ready') {
        branch = prepared.branch;
        return;
      }
      const reset = l10n.t('Reset Branch');
      const choice = await vscode.window.showWarningMessage(
        l10n.t("The branch '{0}' has commits that are not in this pull request. Resetting it to the pull request loses them.", prepared.branch),
        { modal: true },
        reset,
      );
      if (choice === reset) {
        await resetPullRequestBranch(git, prepared.branch, prepared.sha);
        branch = prepared.branch;
      }
    });
    return branch;
  }

  /**
   * Checks the pull request out, then hands over to the branch checkout or the worktree form, so the pull request is
   * checked out like any other branch: with the same prompts for local changes and submodules.
   */
  private async checkout(node: SidebarNode | undefined, inWorktree: boolean): Promise<void> {
    const found = this.find(node);
    if (!found) {
      return;
    }
    const { pull, remote, repoRoot } = found;
    await this.window.selectRepository(repoRoot);
    const branch = await this.prepareBranch(pull, remote);
    if (!branch) {
      return;
    }
    log.info(`pull request ${pull.number} is on ${branch}`);
    await (inWorktree ? this.window.runCheckoutAsWorktree(branch) : this.window.runCheckout(branch, true));
  }

  /** Checks out the branch of a stack's layer: the local branch it is from when there is one, else `pr/<n>`. */
  private async checkoutLayer(root: string, pull: PullRequestDto, remote: string): Promise<void> {
    const git = this.cliRegistry.getOrCreate(root);
    let local = false;
    try {
      local = (await git.execRead(['rev-parse', '--verify', '--quiet', `refs/heads/${pull.headRef}`])).stdout.trim() !== '';
    } catch (error) {
      // No branch of that name here, which is usual for a stack someone else made.
      log.debug(`${pull.headRef} is not a local branch`, error);
    }
    await this.window.selectRepository(root);
    const branch = local ? pull.headRef : await this.prepareBranch(pull, remote);
    if (branch) {
      log.info(`stack layer #${pull.number} is on ${branch}`);
      await this.window.runCheckout(branch, true);
    }
  }

  /** Moves from the checked-out branch to the layer above or below it in its stack, or to the top or bottom. */
  private async moveInStack(move: StackMove): Promise<void> {
    const root = this.window.activeRepoRoot();
    const stacks = root ? this.store.stacks(root) : undefined;
    if (!root || !stacks) {
      void vscode.window.showInformationMessage(l10n.t('The pull requests of this repository are not loaded.'));
      return;
    }
    const current = (await this.cliRegistry.getOrCreate(root).execRead(['branch', '--show-current'])).stdout.trim();
    const here = locateLayer(stacks.chains, current);
    if (!here) {
      void vscode.window.showInformationMessage(l10n.t("'{0}' is not in a stack of pull requests.", current));
      return;
    }
    const target = moveInStack(here.chain, here.index, move);
    if (!target) {
      void vscode.window.showInformationMessage(move === 'up' || move === 'top'
        ? l10n.t("'{0}' is already at the top of its stack.", current)
        : l10n.t("'{0}' is already at the bottom of its stack.", current));
      return;
    }
    await this.checkoutLayer(root, target, stacks.remote);
  }

  /** Asks which layer of a stack to check out: of the stack that was right-clicked, or the checked-out branch's, or else one picked first. */
  private async pickLayer(node?: SidebarNode): Promise<void> {
    const root = node?.repoRoot ?? this.window.activeRepoRoot();
    const stacks = root ? this.store.stacks(root) : undefined;
    if (!root || !stacks) {
      void vscode.window.showInformationMessage(l10n.t('The pull requests of this repository are not loaded.'));
      return;
    }
    if (stacks.chains.length === 0) {
      void vscode.window.showInformationMessage(l10n.t('No stacks of pull requests are open.'));
      return;
    }
    const current = (await this.cliRegistry.getOrCreate(root).execRead(['branch', '--show-current'])).stdout.trim();
    let chain: PullRequestChain | undefined = node?.ref ? stacks.chains.find((entry) => String(entry.pulls[0].number) === node.ref) : locateLayer(stacks.chains, current)?.chain;
    if (!chain) {
      const stack = await vscode.window.showQuickPick(
        stacks.chains.map((entry) => ({ label: entry.pulls[entry.pulls.length - 1].headRef, description: l10n.t('{0} pull requests into {1}', entry.pulls.length, entry.base), entry })),
        { placeHolder: l10n.t('Select a stack') },
      );
      chain = stack?.entry;
    }
    if (!chain) {
      return;
    }
    const layer = await vscode.window.showQuickPick(
      chain.pulls.map((pull, index) => ({
        label: `$(git-pull-request) #${pull.number} ${pull.title}`,
        description: [l10n.t('{0} of {1}', index + 1, chain.pulls.length), pull.headRef === current ? l10n.t('checked out') : ''].filter(Boolean).join(' · '),
        detail: `${pull.headRef} → ${pull.baseRef}`,
        pull,
      })),
      { placeHolder: l10n.t('Select a layer to check out'), title: l10n.t('Check Out Stack Layer') },
    );
    if (layer) {
      await this.checkoutLayer(root, layer.pull, stacks.remote);
    }
  }

  /**
   * Opens the form for a stack of pull requests from a branch: its commits, which of them end a pull request, and the
   * branch and title of each. Submitting makes the new branches, pushes them and opens the pull requests.
   */
  private async createStack(target?: { ref?: string; repoRoot?: string }): Promise<void> {
    const branch = target?.ref;
    const root = target?.repoRoot ?? this.window.activeRepoRoot();
    if (!branch || !root) {
      return;
    }
    const cli = this.cliRegistry.getOrCreate(root);
    const github = await loadGitHubRemote(cli);
    if (!github) {
      void vscode.window.showWarningMessage(l10n.t('This repository has no GitHub remote.'));
      return;
    }
    const loaded = await loadStackCommits(cli, branch);
    if (loaded.kind === 'noBase') {
      void vscode.window.showInformationMessage(l10n.t("Could not find the branch that '{0}' would merge into.", branch));
      return;
    }
    if (loaded.kind === 'merges') {
      void vscode.window.showInformationMessage(l10n.t("'{0}' has a merge commit, so it cannot be cut into pull requests.", branch));
      return;
    }
    if (loaded.kind === 'tooMany') {
      void vscode.window.showInformationMessage(l10n.t("'{0}' has {1} commits. A stack can be made from at most {2}.", branch, loaded.count, MAX_STACK_COMMITS));
      return;
    }
    if (loaded.commits.length === 0) {
      void vscode.window.showInformationMessage(l10n.t("'{0}' has no commits that '{1}' does not have.", branch, loaded.base));
      return;
    }
    const existing = (await cli.execRead(['for-each-ref', '--format=%(refname:short)', 'refs/heads'])).stdout.split('\n').filter(Boolean);
    const context: StackFormContext = {
      branch,
      baseName: baseBranchName(loaded.base, github.remote),
      commits: loaded.commits,
      existingBranches: new Set(existing),
    };
    await this.window.selectRepository(root);
    await this.window.operationForm.show(stackForm(context), {
      validate: (values) => validateStackForm(context, values),
      submit: async (values) => {
        const access = await this.store.writeAccess();
        if (!access) {
          throw new Error(l10n.t('Sign in to GitHub to create pull requests.'));
        }
        const plan = stackPlanFromValues(context, values);
        log.info(`creating ${plan.layers.length} pull request(s) from ${branch}`);
        let outcome;
        try {
          outcome = await createPullRequests(cli, github.remote, github.repo, access.token, plan, access.transport);
        } catch (error) {
          if (error instanceof GitHubRestError && error.failure === 'unauthorized') {
            throw new Error(l10n.t('GitHub did not accept the sign-in. Sign in again and retry.'));
          }
          throw error;
        }
        this.store.refresh();
        const top = outcome.pullRequests.at(-1);
        const open = l10n.t('Open Pull Request');
        const message = outcome.pullRequests.length === 1
          ? l10n.t('Opened pull request #{0}.', outcome.pullRequests[0].number)
          : outcome.stack
            ? l10n.t('Opened {0} pull requests as a stack.', outcome.pullRequests.length)
            : outcome.stackProblem
              ? l10n.t('Opened {0} pull requests. They could not be grouped as a stack: {1}', outcome.pullRequests.length, outcome.stackProblem)
              : l10n.t('Opened {0} pull requests.', outcome.pullRequests.length);
        void vscode.window.showInformationMessage(message, open).then((choice) => {
          if (choice === open && top) {
            void vscode.env.openExternal(vscode.Uri.parse(top.url));
          }
        });
        return true;
      },
    });
  }
}
