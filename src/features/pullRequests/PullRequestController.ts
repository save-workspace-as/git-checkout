import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import { createLogger } from '../../log';
import { canonicalGitHubIssueUrl } from '../../shared/history/githubReferences';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';
import { PULL_REQUEST_COMMANDS } from '../../ui/pullRequestNodes';
import type { SidebarNode } from '../../ui/sidebarTreeModel';
import { preparePullRequestBranch, resetPullRequestBranch } from './pullRequestCheckout';
import type { PullRequestStore } from './PullRequestStore';

const log = createLogger('pull-requests');

type Window = Pick<GitCheckoutPanelManager, 'selectRepository' | 'runCheckout' | 'runCheckoutAsWorktree' | 'sync'>;

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
      vscode.commands.registerCommand(C.signIn, () => this.store.signIn(false)),
      vscode.commands.registerCommand(C.grantAccess, () => this.store.signIn(true)),
      vscode.commands.registerCommand(C.checkout, (node?: SidebarNode) => this.checkout(node, false)),
      vscode.commands.registerCommand(C.checkoutInWorktree, (node?: SidebarNode) => this.checkout(node, true)),
      vscode.commands.registerCommand(C.openOnGitHub, (node?: SidebarNode) => this.openOnGitHub(node)),
      vscode.commands.registerCommand(C.copyLink, (node?: SidebarNode) => this.copyLink(node)),
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

  /**
   * Gets the pull request's head onto the branch `pr/<n>` in the same way as other long operations (progress, the check for
   * a merge or rebase in progress, errors), then hands over to the branch checkout or the worktree form, so the pull
   * request is checked out like any other branch: with the same prompts for local changes and submodules.
   */
  private async checkout(node: SidebarNode | undefined, inWorktree: boolean): Promise<void> {
    const found = this.find(node);
    if (!found) {
      return;
    }
    const { pull, remote, repoRoot } = found;
    await this.window.selectRepository(repoRoot);
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
    if (!branch) {
      return;
    }
    log.info(`pull request ${pull.number} is on ${branch}`);
    await (inWorktree ? this.window.runCheckoutAsWorktree(branch) : this.window.runCheckout(branch, true));
  }
}
