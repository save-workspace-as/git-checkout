import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { PushCatalog, PushChoices } from './pushOptions';
import type { ShowOperationForm } from '../../panel/operationFormController';

export async function promptPushChoices(
  catalog: PushCatalog,
  initial: PushChoices,
  show: ShowOperationForm,
): Promise<PushChoices | undefined> {
  if (catalog.remotes.length === 0) {
    void vscode.window.showWarningMessage(l10n.t('No remotes to push to.'));
    return undefined;
  }
  let choices: PushChoices | undefined;
  await show({
    title: l10n.t('Push'),
    submitLabel: l10n.t('Push'),
    values: { ...initial },
    fields: [
      { id: 'branch', type: 'text', label: l10n.t('Branch'), required: true,
        description: l10n.t('The local branch to push to this remote.'),
        suggestions: catalog.localBranches.map((value) => ({ value })) },
      { id: 'remote', type: 'text', label: l10n.t('To'), required: true,
        description: l10n.t('Push your commits to this remote.'),
        suggestions: catalog.remotes.map((value) => ({ value })) },
      { id: 'tags', type: 'checkbox', group: l10n.t('Options'), label: l10n.t('Push all tags') },
      { id: 'force', type: 'checkbox', group: l10n.t('Options'), label: l10n.t('Force push') },
    ],
  }, {
    validate: () => ({}),
    submit: async (values) => {
      if (values.force === true) {
        const confirm = await vscode.window.showWarningMessage(
          l10n.t('Push with --force-with-lease? This rejects the push if the remote branch changed.'),
          { modal: true }, l10n.t('Push'),
        );
        if (confirm !== l10n.t('Push')) { return false; }
      }
      choices = {
        remote: String(values.remote), branch: String(values.branch),
        tags: values.tags === true, force: values.force === true,
      };
      return true;
    },
  });
  return choices;
}
