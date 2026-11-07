import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { createLogger } from '../../log';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';
import { cleanChoice, cleanForm, deleteMergedBranchesForm, MERGED_PREFIX, requireTicked, sparseChoice, sparseForm, tickedItems, validateCleanForm, validateSparseForm } from './housekeepingForms';
import { HousekeepingService } from './housekeepingService';
import { StatisticsService } from '../statistics/statisticsService';

const log = createLogger('housekeeping');

/** What HousekeepingController needs from the window that owns it. */
export type HousekeepingContext = Pick<GitCheckoutPanelManager, 'activeRepoRoot' | 'cliRegistry' | 'graphReady' | 'operationForm' | 'sync'>;

/** Prune stale remote branches, delete merged branches, clean untracked files and run garbage collection. */
export class HousekeepingController {
  private service: HousekeepingService | undefined;

  constructor(private readonly ctx: HousekeepingContext) {}

  private housekeeping(): HousekeepingService {
    this.service ??= new HousekeepingService(this.ctx.cliRegistry);
    return this.service;
  }

  private repoRoot(): string | undefined {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return undefined;
    }
    return root;
  }

  /** Runs `read` behind a progress notification and reports a failure instead of throwing it. */
  private async looking<T>(title: string, read: () => Promise<T>): Promise<T | undefined> {
    try {
      return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, read);
    } catch (error) {
      log.error(title, error);
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }

  async runPruneRemote(): Promise<void> {
    const root = this.repoRoot();
    if (!root) { return; }
    const remotes = await this.looking(l10n.t('Reading remotes…'), () => this.housekeeping().remotes(root));
    if (!remotes) { return; }
    if (remotes.length === 0) {
      void vscode.window.showInformationMessage(l10n.t('This repository has no remotes.'));
      return;
    }
    const remote = remotes.length === 1 ? remotes[0]
      : await vscode.window.showQuickPick(remotes, { placeHolder: l10n.t('Remote to prune') });
    if (!remote) { return; }
    const stale = await this.looking(l10n.t('Asking {0}…', remote), () => this.housekeeping().prunable(root, remote));
    if (!stale) { return; }
    if (stale.length === 0) {
      void vscode.window.showInformationMessage(l10n.t('Nothing to prune: every remote-tracking branch of {0} still exists there.', remote));
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      l10n.t('Remove {0} remote-tracking branches that no longer exist on {1}?', stale.length, remote),
      { modal: true, detail: stale.join('\n') },
      l10n.t('Prune'),
    );
    if (confirm !== l10n.t('Prune')) { return; }
    await this.ctx.sync.runSyncOp(l10n.t('Pruning {0}', remote), (repoRoot) => this.housekeeping().prune(repoRoot, remote));
  }

  async runDeleteMergedBranches(): Promise<void> {
    const root = this.repoRoot();
    if (!root) { return; }
    const merged = await this.looking(l10n.t('Finding merged branches…'), () => this.housekeeping().mergedBranches(root));
    if (!merged) { return; }
    if (merged.length === 0) {
      void vscode.window.showInformationMessage(l10n.t('No branches are merged into the current branch.'));
      return;
    }
    await this.ctx.operationForm.show(deleteMergedBranchesForm(merged), {
      validate: (values) => requireTicked(MERGED_PREFIX, merged, values, l10n.t('Select at least one branch to delete.')),
      submit: async (values) => {
        const picked = tickedItems(MERGED_PREFIX, merged, values);
        await this.ctx.sync.runSyncOp(l10n.t('Deleting merged branches'), (repoRoot) =>
          this.housekeeping().deleteBranches(repoRoot, picked));
        return true;
      },
    });
  }

  async runCleanUntracked(): Promise<void> {
    const root = this.repoRoot();
    if (!root) { return; }
    const found = await this.looking(l10n.t('Finding files…'), async () => ({
      untracked: await this.housekeeping().cleanPreview(root, false),
      all: await this.housekeeping().cleanPreview(root, true),
    }));
    if (!found) { return; }
    if (found.all.length === 0) {
      void vscode.window.showInformationMessage(l10n.t('There is nothing to clean.'));
      return;
    }
    await this.ctx.operationForm.show(cleanForm(found), {
      validate: (values) => validateCleanForm(found, values),
      submit: async (values) => {
        const { paths, ignored } = cleanChoice(found, values);
        const confirm = await vscode.window.showWarningMessage(
          l10n.t('Permanently delete {0} files and folders? This cannot be undone.', paths.length),
          { modal: true, detail: paths.join('\n') },
          l10n.t('Delete'),
        );
        if (confirm !== l10n.t('Delete')) { return false; }
        await this.ctx.sync.runSyncOp(l10n.t('Cleaning'), (repoRoot) => this.housekeeping().clean(repoRoot, paths, ignored));
        return true;
      },
    });
  }

  async runSparseCheckout(): Promise<void> {
    const root = this.repoRoot();
    if (!root) { return; }
    const known = await this.looking(l10n.t('Reading folders…'), async () => ({
      folders: await this.housekeeping().topLevelFolders(root),
      kept: await this.housekeeping().sparseFolders(root),
    }));
    if (!known) { return; }
    await this.ctx.operationForm.show(sparseForm(known), {
      validate: (values) => validateSparseForm(known, values),
      submit: async (values) => {
        const choice = sparseChoice(known, values);
        if (choice.kind === 'disable') {
          await this.ctx.sync.runSyncOp(l10n.t('Checking out everything'), (repoRoot) => this.housekeeping().disableSparse(repoRoot));
        } else {
          await this.ctx.sync.runSyncOp(l10n.t('Narrowing the checkout'), (repoRoot) => this.housekeeping().setSparseFolders(repoRoot, choice.folders));
        }
        return true;
      },
    });
  }

  async runStatistics(): Promise<void> {
    const root = this.repoRoot();
    if (!root) { return; }
    const stats = await this.looking(l10n.t('Counting…'), () => new StatisticsService(this.ctx.cliRegistry).load(root));
    if (!stats) { return; }
    const row = (label: string, description: string): vscode.QuickPickItem => ({ label, description });
    const items: vscode.QuickPickItem[] = [
      { label: l10n.t('Summary'), kind: vscode.QuickPickItemKind.Separator },
      row(l10n.t('Commits'), String(stats.commits)),
      row(l10n.t('Local branches'), String(stats.branches)),
      row(l10n.t('Tags'), String(stats.tags)),
      ...(stats.firstCommit ? [row(l10n.t('First commit'), new Date(stats.firstCommit).toLocaleDateString())] : []),
      row(l10n.t('Size on disk'), l10n.t('{0} packed, {1} loose', stats.sizes.packed, stats.sizes.loose)),
      { label: l10n.t('Contributors'), kind: vscode.QuickPickItemKind.Separator },
      ...stats.contributors.map((person) => ({ label: person.name, description: l10n.t('{0} commits', person.commits), detail: person.email || undefined })),
    ];
    await vscode.window.showQuickPick(items, { title: l10n.t('Repository Statistics'), placeHolder: l10n.t('Commits by contributor on the current branch') });
  }

  async runGc(): Promise<void> {
    await this.ctx.sync.runSyncOp(l10n.t('Running garbage collection'), (repoRoot) => this.housekeeping().gc(repoRoot));
  }
}
