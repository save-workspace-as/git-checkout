import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { executeAddRemote, listRemoteNames, testRemoteUrl, validateRemoteName, validateRemoteUrl } from './addRemote';
import type { GitCli } from '../../core/gitCli';
import type { OperationFormErrors, OperationFormValues } from '../../shared/forms/operationForm';
import type { ShowOperationForm } from '../../panel/operationFormController';
import { remoteAddForm } from '../../panel/operationForms';

function validateRemoteForm(values: OperationFormValues, existing: readonly string[]): OperationFormErrors {
  const errors: OperationFormErrors = {};
  const name = validateRemoteName(String(values.name), existing);
  const url = validateRemoteUrl(String(values.url));
  if (name) { errors.name = name; }
  if (url) { errors.url = url; }
  return errors;
}

export async function addRemoteInForm(show: ShowOperationForm, cli: GitCli): Promise<boolean> {
  const existing = await listRemoteNames(cli);
  return show(remoteAddForm(existing), {
    validate: (values) => validateRemoteForm(values, existing),
    async pick(_field, values) {
      const problem = await testRemoteUrl(cli, String(values.url));
      if (problem) { throw new Error(problem); }
      void vscode.window.showInformationMessage(l10n.t('The remote URL is reachable'));
      return undefined;
    },
    async submit(values) {
      await executeAddRemote(cli, { name: String(values.name).trim(), url: String(values.url).trim() });
      return true;
    },
  });
}
