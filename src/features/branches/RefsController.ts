import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { defaultStartRef } from '../graph/commitGraphService';
import { GitCliError } from '../../core/gitCliError';
import { createLogger } from '../../log';
import type { WorktreeStatusDto } from '../../shared/changes/dailyGitProtocol';
import { ALL_COMMITS_FILTER } from '../../shared/graph/graphProtocol';
import type { RefsMutateOp, RefsSnapshotDto } from '../../shared/branches/refsProtocol';
import { type StashEntryDto } from '../../shared/stash/stashProtocol';
import type { GitSubmoduleDto } from '../../shared/submodules/submoduleProtocol';
import type { GitWorktreeDto } from '../../shared/worktrees/worktreeProtocol';
import { copyTextToClipboard } from '../../panel/clipboardHost';
import { runRefsMutation } from './refsMutationsHost';
import { promptUpstreamRef } from './setUpstreamHost';
import { tagDetailsForm } from '../../panel/operationForms';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';

const log = createLogger('branches');
const CHANGES_TAB_FOCUS_COMMAND = 'gitCheckout.unstaged.focus';

/** What RefsController needs from the window that owns it. */
export type RefsContext = Pick<
  GitCheckoutPanelManager,
  | '_onDidChangeRefs'
  | 'activeBranchCompare'
  | 'activeRepoRoot'
  | 'bottomFocusCommand'
  | 'cliRegistry'
  | 'commitDetailsService'
  | 'createOrReveal'
  | 'gitService'
  | 'graphReady'
  | 'graphService'
  | 'operationForm'
  | 'postState'
  | 'postWhenReady'
  | 'refsService'
  | 'reloadGraphOnHeadChange'
  | 'remoteSyncService'
  | 'runFastForward'
  | 'runPullBranch'
  | 'runOpenPullRequest'
  | 'runPushBranch'
  | 'setBranchCompareActive'
  | 'showRefInGraph'
  | 'stashService'
  | 'submoduleService'
  | 'sync'
  | 'workingTreeService'
  | 'worktreeService'
>;

export class RefsController {
  constructor(private readonly ctx: RefsContext) {}

  async loadSidebarData(repoRoot?: string): Promise<{
    snapshot: RefsSnapshotDto;
    worktree: WorktreeStatusDto;
    stashes: StashEntryDto[];
    worktrees: GitWorktreeDto[];
    submodules: GitSubmoduleDto[];
  } | null> {
    const active = this.ctx.activeRepoRoot();
    const root = repoRoot ?? active;
    if (!root || !this.ctx.graphReady()) {
      return null;
    }
    const [snapshot, worktree, stashes, worktrees, submodules] = await Promise.all([
      this.ctx.refsService.loadSnapshot(root),
      this.ctx.workingTreeService.getStatus(root),
      this.ctx.stashService.list(root).catch((error: unknown) => {
        log.warn('stash list failed', error);
        return [];
      }),
      this.ctx.worktreeService.list(root).catch((error: unknown) => {
        log.warn('worktree list failed', error);
        return [];
      }),
      this.ctx.submoduleService.list(root).catch((error: unknown) => {
        log.warn('submodule list failed', error);
        return [];
      }),
    ]);
    return { snapshot, worktree, stashes, worktrees, submodules };
  }

  runCopyBranchName(branchName: string): Promise<void> {
    return copyTextToClipboard(branchName);
  }

  async runShowTagDetails(tagName: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    const message = await this.ctx.commitDetailsService.readMessage(root, `refs/tags/${tagName}`);
    await this.ctx.operationForm.show(tagDetailsForm(tagName, message), {
      validate: () => ({}),
      submit: async () => true,
    });
  }

  /** An action from the menu of a branch badge in the graph. */
  async runBranchBadgeAction(
    action: 'fastForward' | 'pull' | 'push' | 'rename' | 'copyName' | 'pullRequest',
    ref: string,
  ): Promise<void> {
    if (!ref) {
      return;
    }
    switch (action) {
      case 'fastForward':
        return this.ctx.runFastForward(ref);
      case 'pull':
        return this.ctx.runPullBranch(ref);
      case 'push':
        return this.ctx.runPushBranch(ref);
      case 'rename':
        return this.runRefsMutate({ op: 'branchRename', name: ref });
      case 'copyName':
        return this.runCopyBranchName(ref);
      case 'pullRequest':
        return this.ctx.runOpenPullRequest(ref);
    }
  }

  showAllCommits(): Promise<void> {
    return this.ctx.showRefInGraph(ALL_COMMITS_FILTER);
  }

  /** Shows the Changes tab of the bottom panel, opening the window first when there is none. */
  showLocalChanges(): void {
    this.ctx.bottomFocusCommand = CHANGES_TAB_FOCUS_COMMAND;
    this.ctx.createOrReveal();
    void vscode.commands.executeCommand(CHANGES_TAB_FOCUS_COMMAND);
    this.ctx.postWhenReady({ type: 'workingCopyFocus' });
  }

  async runRefsCompare(base: string, compare: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      return;
    }
    this.ctx.createOrReveal();
    try {
      const result = await this.ctx.refsService.compareBranches(root, base, compare);
      this.ctx.activeBranchCompare = { base: result.base, compare: result.compare };
      this.ctx.setBranchCompareActive(true);
      this.ctx.postWhenReady({ type: 'refsCompareResult', result });
    } catch (error) {
      const message =
        error instanceof GitCliError ? `${error.code}: ${error.message}` : String(error);
      log.error(`compare ${base}...${compare} failed: ${message}`, error);
      void vscode.window.showErrorMessage(message);
    }
  }

  async runRefsMutate(mutate: RefsMutateOp): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      return;
    }

    if (mutate.op === 'branchSetUpstream') {
      const snapshot = await this.ctx.refsService.loadSnapshot(root);
      const upstreamRef = await promptUpstreamRef(snapshot, mutate.name, this.ctx.operationForm.show);
      if (!upstreamRef) {
        return;
      }
      await this.ctx.sync.runSyncOp(l10n.t('Set upstream'), (repoRoot, token) =>
        this.ctx.remoteSyncService.setUpstream(repoRoot, mutate.name, upstreamRef, {
          cancellationToken: token,
        }),
      );
      this.ctx._onDidChangeRefs.fire();
      return;
    }

    if (mutate.op === 'branchUnsetUpstream') {
      await this.ctx.sync.runSyncOp(l10n.t('Removing upstream'), (repoRoot, token) =>
        this.ctx.remoteSyncService.unsetUpstream(repoRoot, mutate.name, {
          cancellationToken: token,
        }),
      );
      this.ctx._onDidChangeRefs.fire();
      return;
    }

    const repo = this.ctx.gitService.getRepositories().find((r) => r.rootUri.fsPath === root);
    if (!repo) {
      return;
    }
    const cli = this.ctx.cliRegistry.forRepository(repo);
    const headRef = await this.ctx.graphService.currentBranch(root);
    const defaultStart = defaultStartRef(this.ctx.graphService.shownRef(root), headRef);
    const ok = await runRefsMutation(cli, mutate, headRef, defaultStart, this.ctx.operationForm.show);
    if (!ok) {
      return;
    }
    this.ctx._onDidChangeRefs.fire();
    void this.ctx.reloadGraphOnHeadChange();
    await this.ctx.postState('state');
  }
}
