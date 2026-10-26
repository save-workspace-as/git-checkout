import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { testRemoteUrl } from '../sync/addRemote';
import { validateClone, type CloneRequest } from './cloneRequest';
import type { GitCli } from '../../core/gitCli';
import type { ShowOperationForm } from '../../panel/operationFormController';
import { cloneForm } from '../../panel/operationForms';

/** Asks for a URL and a folder; resolves to what was entered, or undefined when the form is canceled. */
export async function cloneInForm(
  show: ShowOperationForm,
  cli: GitCli,
  location: string,
): Promise<CloneRequest | undefined> {
  let request: CloneRequest | undefined;
  const asRequest = (values: Record<string, string | boolean>): CloneRequest =>
    ({ url: String(values.url).trim(), location: String(values.location).trim() });
  await show(cloneForm(location), {
    validate: (values) => validateClone(asRequest(values)),
    async pick(field, values) {
      if (field === 'location') {
        const chosen = await vscode.window.showOpenDialog({
          title: l10n.t('Folder for the repository'),
          canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
          defaultUri: vscode.Uri.file(String(values.location).trim() || location),
        });
        return chosen?.[0]?.fsPath;
      }
      const problem = await testRemoteUrl(cli, String(values.url));
      if (problem) { throw new Error(problem); }
      void vscode.window.showInformationMessage(l10n.t('The remote URL is reachable'));
      return undefined;
    },
    async submit(values) {
      request = asRequest(values);
      return true;
    },
  });
  return request;
}
