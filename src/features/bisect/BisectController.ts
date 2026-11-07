import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { GitCliError } from '../../core/gitCliError';
import { createLogger } from '../../log';
import { bisectCheckoutSha, IDLE_BISECT_STATE, type BisectMark } from '../../shared/bisect/bisectProtocol';
import { bisectStartForm } from '../../panel/operationForms';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';

const log = createLogger('bisect');

/** What BisectController needs from the window that owns it. */
export type BisectContext = Pick<
  GitCheckoutPanelManager,
  | '_onDidChangeRefs'
  | 'activeRepoRoot'
  | 'bisectService'
  | 'createOrReveal'
  | 'graphReady'
  | 'operationForm'
  | 'postMessage'
  | 'postState'
  | 'reloadGraphOnHeadChange'
  | 'repoOperationService'
  | 'setContext'
  | 'sync'
  | 'syncRepoOperationContext'
>;

export class BisectController {
  constructor(private readonly ctx: BisectContext) {}

  async runBisectStart(): Promise<void> {
    await this.ctx.operationForm.show(bisectStartForm(), {
      validate: () => ({}),
      submit: async (values) => {
        const bad = String(values.bad).trim();
        const good = String(values.good).trim();
        const root = this.ctx.activeRepoRoot();
        if (root) {
          for (const revision of [bad, good].filter(Boolean)) {
            await this.ctx.bisectService.verifyRevision(root, revision);
          }
        }
        await this.runBisect(l10n.t('Starting bisect'), (root, token) =>
          this.ctx.bisectService.start(root, bad, good, { cancellationToken: token }),
        );
        return true;
      },
    });
  }

  runBisectMark(mark: BisectMark, rev?: string): Promise<void> {
    const title =
      mark === 'good' ? l10n.t('Marking good') : mark === 'bad' ? l10n.t('Marking bad') : l10n.t('Skipping commit');
    return this.runBisect(title, (root, token) =>
      this.ctx.bisectService.mark(root, mark, rev, { cancellationToken: token }),
    );
  }

  async runBisectReset(): Promise<void> {
    const choice = await vscode.window.showWarningMessage(
      l10n.t('Reset bisect and return to the branch you started on?'),
      { modal: true },
      l10n.t('Reset Bisect'),
    );
    if (choice !== l10n.t('Reset Bisect')) {
      return;
    }
    await this.runBisect(l10n.t('Resetting bisect'), (root, token) =>
      this.ctx.bisectService.reset(root, { cancellationToken: token }),
    );
  }

  async setBisectActive(active: boolean): Promise<void> {
    await this.ctx.setContext('gitCheckout.bisectActive', active);
  }

  /** Pushes bisect marks to the graph and selects the commit git checked out to test. */
  async publishBisectSession(): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      await this.setBisectActive(false);
      this.ctx.postMessage({ type: 'graphBisect', state: IDLE_BISECT_STATE });
      return;
    }
    try {
      const state = await this.ctx.bisectService.read(root);
      await this.setBisectActive(state.active);
      this.ctx.postMessage({ type: 'graphBisect', state });
      const sha = bisectCheckoutSha(state);
      if (sha) {
        this.ctx.postMessage({ type: 'graphReveal', ref: sha.slice(0, 7), sha, reachable: true });
      }
    } catch (error) {
      log.warn('bisect session could not be restored', error);
      await this.setBisectActive(false);
    }
  }

  private async runBisect(
    title: string,
    op: (repoRoot: string, token: vscode.CancellationToken) => Promise<void>,
  ): Promise<void> {
    this.ctx.createOrReveal();
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    const operation = await this.ctx.repoOperationService.getStatus(root);
    if (operation.active && operation.kind !== 'bisect') {
      void vscode.window.showWarningMessage(
        operation.summary || l10n.t('Finish or abort the in-progress Git operation first.'),
      );
      return;
    }

    this.ctx.sync.setSyncBusy(true);
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
      const message = error instanceof GitCliError ? `${error.code}: ${error.message}` : String(error);
      log.error(`bisect failed: ${message}`, error);
      void vscode.window.showErrorMessage(message);
    } finally {
      this.ctx.sync.setSyncBusy(false);
      this.ctx._onDidChangeRefs.fire();
      await this.ctx.syncRepoOperationContext();
      await this.ctx.reloadGraphOnHeadChange();
      await this.ctx.postState('state');
    }
  }
}
