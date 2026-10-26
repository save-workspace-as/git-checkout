import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { branchNamesForRemote, type PullCatalog, type PullChoices } from './pullOptions';
import type { ShowOperationForm } from '../../panel/operationFormController';

function intoBranches(catalog: PullCatalog): string[] {
  const head = catalog.headName;
  const others = catalog.localBranches.filter((name) => name !== head);
  return head ? [head, ...others] : others;
}

export async function promptPullChoices(
  catalog: PullCatalog,
  initial: PullChoices,
  show: ShowOperationForm,
): Promise<PullChoices | undefined> {
  if (catalog.remotes.length === 0) {
    void vscode.window.showWarningMessage(l10n.t('No remotes to pull from.'));
    return undefined;
  }
  let choices: PullChoices | undefined;
  await show({
    title: l10n.t('Pull'),
    submitLabel: l10n.t('Pull'),
    values: { ...initial, into: initial.into ?? catalog.headName ?? 'HEAD' },
    fields: [
      { id: 'remote', type: 'text', label: l10n.t('Remote'), required: true,
        description: l10n.t('Fetch and integrate changes from this remote.'),
        suggestions: catalog.remotes.map((value) => ({ value })) },
      { id: 'branch', type: 'text', label: l10n.t('Branch'), required: true,
        description: l10n.t('The branch to pull from this remote.'),
        suggestions: catalog.remotes.flatMap((remote) => branchNamesForRemote(catalog, remote).map((value) => ({
          value, when: { field: 'remote', value: remote },
        }))) },
      // The checked-out branch first: pulling into it updates the working tree; any other branch is
      // fast-forwarded without being checked out.
      { id: 'into', type: 'text', label: l10n.t('Into'), required: true,
        description: l10n.t('The local branch that receives the pulled commits.'),
        suggestions: intoBranches(catalog).map((value) => ({ value })) },
      { id: 'rebase', type: 'checkbox', group: l10n.t('Options'), label: l10n.t('Rebase instead of merge') },
      { id: 'stash', type: 'checkbox', group: l10n.t('Options'), label: l10n.t('Stash and reapply local changes') },
    ],
  }, {
    validate: () => ({}),
    submit: async (values) => {
      choices = {
        remote: String(values.remote), branch: String(values.branch),
        rebase: values.rebase === true, stash: values.stash === true, into: String(values.into),
      };
      return true;
    },
  });
  return choices;
}
