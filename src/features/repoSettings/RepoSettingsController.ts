import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { GitCliError } from '../../core/gitCliError';
import { createLogger } from '../../log';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';
import { parseConfigList, repoSettingsChanges, repoSettingsForm } from './repoSettingsForm';

const log = createLogger('repo-settings');

/** What RepoSettingsController needs from the window that owns it. */
export type RepoSettingsContext = Pick<GitCheckoutPanelManager, 'activeRepoRoot' | 'cliRegistry' | 'graphReady' | 'operationForm'>;

/** Repository Settings: Git's own configuration for one repository, edited in the shared form. */
export class RepoSettingsController {
  constructor(private readonly ctx: RepoSettingsContext) {}

  async open(): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
      return;
    }
    const cli = this.ctx.cliRegistry.getOrCreate(root);
    const config = parseConfigList((await cli.execRead(['config', '--list', '--show-scope', '-z'])).stdout);
    const form = repoSettingsForm(config);
    await this.ctx.operationForm.show(form, {
      validate: () => ({}),
      async pick(field, values) {
        if (field !== 'commit.template') {
          return undefined;
        }
        const current = String(values[field] ?? '').trim();
        const chosen = await vscode.window.showOpenDialog({
          title: l10n.t('Commit message template file'),
          canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
          defaultUri: current ? vscode.Uri.file(current) : vscode.Uri.file(root),
        });
        return chosen?.[0]?.fsPath;
      },
      submit: async (values) => {
        const changes = repoSettingsChanges(form.values, values, config);
        log.info(`repository settings: ${changes.set.length} set, ${changes.unset.length} cleared`);
        for (const [key, value] of changes.set) {
          await cli.execWrite(['config', '--local', key, value]);
        }
        for (const key of changes.unset) {
          try {
            await cli.execWrite(['config', '--local', '--unset-all', key]);
          } catch (error) {
            // Exit code 5: the repository had no value of its own, which is what clearing asks for.
            if (!(error instanceof GitCliError && error.exitCode === 5)) {
              throw error;
            }
            log.debug(`${key} had no repository value`, error);
          }
        }
        return true;
      },
    });
  }
}
