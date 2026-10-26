import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { FetchCatalog, FetchChoices } from './fetchOptions';
import type { ShowOperationForm } from '../../panel/operationFormController';

export async function promptFetchChoices(
  catalog: FetchCatalog,
  initial: FetchChoices,
  show: ShowOperationForm,
): Promise<FetchChoices | undefined> {
  if (catalog.remotes.length === 0) {
    void vscode.window.showWarningMessage(l10n.t('No remotes to fetch from.'));
    return undefined;
  }
  let choices: FetchChoices | undefined;
  await show({
    title: l10n.t('Fetch'),
    submitLabel: l10n.t('Fetch'),
    values: { ...initial },
    fields: [
      { id: 'remote', type: 'text', label: l10n.t('Remote'), required: true,
        description: l10n.t('Download objects and refs from this remote.'),
        suggestions: catalog.remotes.map((value) => ({ value })) },
      {
        id: 'all', type: 'checkbox', label: l10n.t('All remotes'),
        description: l10n.t('Download objects and refs from every remote.'),
      },
    ],
  }, {
    validate: () => ({}),
    submit: async (values) => {
      choices = { remote: String(values.remote), all: values.all === true };
      return true;
    },
  });
  return choices;
}
