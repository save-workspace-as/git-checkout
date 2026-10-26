import * as l10n from '@vscode/l10n';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { GitCliError } from '../../core/gitCliError';
import { getGitCliRegistry } from '../../core/gitCliRegistry';
import { createLogger } from '../../log';
import { cloneInForm } from './cloneHost';
import { cloneGitArgs, cloneTarget, parseCloneArg, parseCloneProgress, repositoryNameFromUrl, type CloneRequest } from './cloneRequest';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';

const log = createLogger('clone');

const CLONE_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/** What CloneController needs from the window that owns it. */
export type CloneContext = Pick<GitCheckoutPanelManager, 'activeRepoRoot' | 'gitSettings' | 'operationForm'>;

export class CloneController {
  constructor(private readonly ctx: CloneContext) {}

  /** Clones a repository from a form, or from `{url, location}` when a command passes them. */
  async runClone(arg?: unknown): Promise<void> {
    const parsed = parseCloneArg(arg);
    if (parsed.status === 'invalid') {
      void vscode.window.showWarningMessage(parsed.message);
      return;
    }
    let request: CloneRequest | undefined;
    if (parsed.status === 'ready') {
      request = parsed.request;
    } else {
      const root = this.ctx.activeRepoRoot();
      const start = this.ctx.gitSettings.cloneDefaultFolder() || (root ? path.dirname(root) : os.homedir());
      request = await cloneInForm(this.ctx.operationForm.show, this.cli(), start);
    }
    if (request) {
      await this.clone(request);
    }
  }

  // Git runs from the home folder: the destination does not exist yet, and `git clone` is given its full path.
  private cli() {
    return getGitCliRegistry().getOrCreate(os.homedir());
  }

  private async clone(request: CloneRequest): Promise<void> {
    const target = cloneTarget(request);
    const name = repositoryNameFromUrl(request.url);
    try {
      const args = cloneGitArgs(request);
      log.info(`clone into ${target}`);
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: l10n.t('Cloning {0}…', name), cancellable: true },
        (progress, token) => {
          let shown = 0;
          return this.cli().execWrite(args, {
            network: true,
            timeoutMs: CLONE_TIMEOUT_MS,
            cancellationToken: token,
            onStderr(chunk) {
              const update = parseCloneProgress(chunk);
              if (update && update.percent > shown) {
                progress.report({ increment: update.percent - shown, message: update.phase === 'receiving' ? l10n.t('Receiving objects: {0}%', update.percent) : l10n.t('Resolving deltas: {0}%', update.percent) });
                shown = update.percent;
              }
            },
          });
        },
      );
    } catch (error) {
      if (error instanceof GitCliError && error.code === 'Cancelled') {
        // Git removes the half-written folder itself when it is stopped.
        log.info('clone canceled');
        return;
      }
      log.error('clone failed', error);
      void vscode.window.showErrorMessage(l10n.t('Could not clone {0}: {1}', name, error instanceof Error ? error.message : String(error)));
      return;
    }
    void this.offerToOpen(target, name);
  }

  private async offerToOpen(target: string, name: string): Promise<void> {
    const open = l10n.t('Open');
    const openInNewWindow = l10n.t('Open in New Window');
    const choice = await vscode.window.showInformationMessage(l10n.t('Cloned {0}.', name), open, openInNewWindow);
    if (choice) {
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target), { forceNewWindow: choice === openInNewWindow });
    }
  }
}
