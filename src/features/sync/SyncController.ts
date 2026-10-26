import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { initialFetchChoices, loadFetchCatalog, parseFetchCommandArg, type FetchChoices } from './fetchOptions';
import { initialPullChoices, loadPullCatalog, parsePullCommandArg, type PullChoices } from './pullOptions';
import { initialPushChoices, loadPushCatalog, parsePushCommandArg, type PushChoices } from './pushOptions';
import type { OperationFormDefinition, OperationFormErrors } from '../../shared/forms/operationForm';
import { promptFetchChoices } from './fetchHost';
import { promptPullChoices } from './pullHost';
import { promptPushChoices } from './pushHost';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';

/** What SyncController needs from the window that owns it. */
export type SyncContext = Pick<
  GitCheckoutPanelManager,
  | '_onDidChangeRefs'
  | 'activeRepoRoot'
  | 'cliRegistry'
  | 'gitSettings'
  | 'graphReady'
  | 'graphService'
  | 'handleOpError'
  | 'operationForm'
  | 'postState'
  | 'refsService'
  | 'reloadGraphOnHeadChange'
  | 'remoteSyncService'
  | 'repoOperationService'
  | 'setContext'
>;

export class SyncController {
  syncBusy = false;

  constructor(private readonly ctx: SyncContext) {}

  async runFetch(arg?: unknown, initialRemote?: string): Promise<void> {
    const preset = parseFetchCommandArg(arg);
    const root = this.ctx.activeRepoRoot();
    if (!preset) {
      if (!root || !this.ctx.graphReady()) {
        void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
        return;
      }
      const operation = await this.ctx.repoOperationService.getStatus(root);
      if (operation.active) {
        void vscode.window.showWarningMessage(
          operation.summary || l10n.t('Finish or abort the in-progress Git operation first.'),
        );
        return;
      }
    }
    const choices = preset ?? (root ? await this.promptForFetch(root, initialRemote) : undefined);
    if (!choices) {
      return;
    }
    await this.runSyncOp(l10n.t('Fetching'), (repoRoot, token) =>
      this.ctx.remoteSyncService.fetch(repoRoot, {
        cancellationToken: token,
        remote: choices.remote,
        all: choices.all,
      }),
    );
  }

  async runPull(arg?: unknown, initial?: { remote: string; branch: string }): Promise<void> {
    const preset = parsePullCommandArg(arg);
    const root = this.ctx.activeRepoRoot();
    if (!preset) {
      if (!root || !this.ctx.graphReady()) {
        void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
        return;
      }
      const operation = await this.ctx.repoOperationService.getStatus(root);
      if (operation.active) {
        void vscode.window.showWarningMessage(
          operation.summary || l10n.t('Finish or abort the in-progress Git operation first.'),
        );
        return;
      }
    }
    const choices = preset ?? (root ? await this.promptForPull(root, initial) : undefined);
    if (!choices) {
      return;
    }
    await this.runSyncOp(l10n.t('Pulling'), (repoRoot, token) =>
      this.ctx.remoteSyncService.pull(repoRoot, { ...choices, cancellationToken: token }),
    );
  }

  async runPush(arg?: unknown, initialBranch?: string): Promise<boolean> {
    const preset = parsePushCommandArg(arg);
    const root = this.ctx.activeRepoRoot();
    if (!preset) {
      if (!root || !this.ctx.graphReady()) {
        void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
        return false;
      }
      const operation = await this.ctx.repoOperationService.getStatus(root);
      if (operation.active) {
        void vscode.window.showWarningMessage(
          operation.summary || l10n.t('Finish or abort the in-progress Git operation first.'),
        );
        return false;
      }
    }
    const choices = preset ?? (root ? await this.promptForPush(root, initialBranch) : undefined);
    if (!choices) {
      return false;
    }
    const title = choices.force ? l10n.t('Pushing (force-with-lease)') : l10n.t('Pushing');
    await this.runSyncOp(title, async (repoRoot, token) => {
      const repo = this.ctx.remoteSyncService.findRepository(repoRoot);
      const headName = repo?.state.HEAD?.name;
      const hasUpstream = Boolean(repo?.state.HEAD?.upstream?.name);
      await this.ctx.remoteSyncService.push(repoRoot, {
        cancellationToken: token,
        remote: choices.remote,
        branch: choices.branch,
        tags: choices.tags,
        forceWithLease: choices.force,
        setUpstream: !hasUpstream && headName === choices.branch,
      });
    });
    return true;
  }

  /** Fetch, pull or push with the form's starting choices, without showing the form. A repository that has none to offer gets the form. */
  async runQuick(kind: 'fetch' | 'pull' | 'push'): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    const repo = this.ctx.remoteSyncService.findRepository(root);
    const cli = this.ctx.cliRegistry.getOrCreate(root);
    const head = repo?.state.HEAD?.name ?? null;
    const upstream = repo?.state.HEAD?.upstream?.name ?? null;
    switch (kind) {
      case 'fetch':
        return this.runFetch(initialFetchChoices(await loadFetchCatalog(cli, upstream)));
      case 'pull': {
        const catalog = await loadPullCatalog(cli, head, upstream);
        return this.runPull(initialPullChoices(catalog, this.ctx.gitSettings.leanBranchingStashOnSwitch()));
      }
      case 'push':
        return void (await this.runPush(initialPushChoices(await loadPushCatalog(cli, head, upstream))));
    }
  }

  async runPushForceWithLease(): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      l10n.t('Push with --force-with-lease? This rejects the push if the remote branch changed.'),
      { modal: true },
      l10n.t('Push'),
    );
    if (confirm !== l10n.t('Push')) {
      return;
    }
    await this.runSyncOp(l10n.t('Pushing (force-with-lease)'), (root, token) =>
      this.ctx.remoteSyncService.push(root, {
        cancellationToken: token,
        forceWithLease: true,
      }),
    );
  }

  async runPushTag(tagName: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    const snapshot = await this.ctx.refsService.loadSnapshot(root);
    const remotes = snapshot.remotes.map(({ name }) => name);
    if (!remotes.length) {
      void vscode.window.showWarningMessage(l10n.t('No remotes are configured.'));
      return;
    }
    const form: OperationFormDefinition = {
      title: l10n.t('Push Tag'),
      submitLabel: l10n.t('Push'),
      values: { tag: tagName, remote: remotes.includes('origin') ? 'origin' : remotes[0] },
      fields: [
        { id: 'tag', type: 'text', label: l10n.t('Tag'), readOnly: true,
          description: l10n.t('The tag to push.') },
        { id: 'remote', type: 'text', label: l10n.t('Remote'), required: true,
          description: l10n.t('Push this tag to this remote.'),
          suggestions: remotes.map((value) => ({ value })) },
      ],
    };
    await this.ctx.operationForm.show(form, {
      validate: (values): OperationFormErrors => {
        if (remotes.includes(String(values.remote))) { return {}; }
        return { remote: l10n.t('Choose a configured remote.') };
      },
      submit: async (values) => {
        await this.runSyncOp(l10n.t('Pushing tag'), async (repoRoot, token) => {
          await this.ctx.cliRegistry.getOrCreate(repoRoot).execWrite(
            ['push', String(values.remote), `refs/tags/${tagName}`],
            { network: true, cancellationToken: token },
          );
        });
        return true;
      },
    });
  }

  async runFastForward(branchName: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      return;
    }
    await this.runSyncOp(l10n.t('Fast-forwarding branch'), (repoRoot, token) =>
      this.ctx.remoteSyncService.fastForward(repoRoot, branchName, { cancellationToken: token }),
    );
  }

  async runPullBranch(branchName: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      return;
    }
    if (this.ctx.graphService.resolveHeadRef(root) === branchName) {
      await this.runPull();
      return;
    }
    if (!branchName.includes('/') || (await this.isLocalBranch(root, branchName))) {
      // Another branch cannot be pulled into the working tree; bring it up to its upstream instead.
      await this.runFastForward(branchName);
      return;
    }
    const separator = branchName.indexOf('/');
    if (separator > 0) {
      await this.runPull(undefined, {
        remote: branchName.slice(0, separator),
        branch: branchName.slice(separator + 1),
      });
    }
  }

  private async isLocalBranch(root: string, name: string): Promise<boolean> {
    const snapshot = await this.ctx.refsService.loadSnapshot(root);
    return snapshot.branches.some((branch) => branch.name === name);
  }

  async runPushBranch(branchName: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      return;
    }
    await this.runPush(undefined, branchName);
  }

  private async promptForFetch(root: string, initialRemote?: string): Promise<FetchChoices | undefined> {
    const repo = this.ctx.remoteSyncService.findRepository(root);
    const catalog = await loadFetchCatalog(
      this.ctx.cliRegistry.getOrCreate(root),
      repo?.state.HEAD?.upstream?.name ?? null,
    );
    const initial = initialFetchChoices(catalog);
    return promptFetchChoices(catalog, {
      ...initial,
      remote: initialRemote ?? initial.remote,
    }, this.ctx.operationForm.show);
  }

  private async promptForPush(root: string, initialBranch?: string): Promise<PushChoices | undefined> {
    const repo = this.ctx.remoteSyncService.findRepository(root);
    const catalog = await loadPushCatalog(
      this.ctx.cliRegistry.getOrCreate(root),
      repo?.state.HEAD?.name ?? null,
      repo?.state.HEAD?.upstream?.name ?? null,
    );
    const initial = initialPushChoices(catalog);
    return promptPushChoices(catalog, {
      ...initial,
      branch: initialBranch ?? initial.branch,
    }, this.ctx.operationForm.show);
  }

  private async promptForPull(
    root: string,
    initial?: { remote: string; branch: string },
  ): Promise<PullChoices | undefined> {
    const repo = this.ctx.remoteSyncService.findRepository(root);
    const catalog = await loadPullCatalog(
      this.ctx.cliRegistry.getOrCreate(root),
      repo?.state.HEAD?.name ?? null,
      repo?.state.HEAD?.upstream?.name ?? null,
    );
    const choices = initialPullChoices(catalog, this.ctx.gitSettings.leanBranchingStashOnSwitch());
    return promptPullChoices(catalog, {
      ...choices,
      remote: initial?.remote ?? choices.remote,
      branch: initial?.branch ?? choices.branch,
    }, this.ctx.operationForm.show);
  }

  async runSyncOp(
    title: string,
    op: (repoRoot: string, token: vscode.CancellationToken) => Promise<void>,
  ): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }

    const operation = await this.ctx.repoOperationService.getStatus(root);
    if (operation.active) {
      void vscode.window.showWarningMessage(
        operation.summary || l10n.t('Finish or abort the in-progress Git operation first.'),
      );
      return;
    }

    this.setSyncBusy(true);
    await this.ctx.postState('state');

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: l10n.t('Git Checkout: {0}', title),
          cancellable: true,
        },
        async (_progress, token) => {
          await op(root, token);
        },
      );
    } catch (error) {
      await this.ctx.handleOpError(root, error);
    } finally {
      this.setSyncBusy(false);
      await this.ctx.postState('state');
      this.ctx._onDidChangeRefs.fire();
      void this.ctx.reloadGraphOnHeadChange();
    }
  }

  /** Drives `enablement` of the sync actions in the panel's title bar. */
  setSyncBusy(busy: boolean): void {
    this.syncBusy = busy;
    void this.ctx.setContext('gitCheckout.syncBusy', busy);
  }
}
