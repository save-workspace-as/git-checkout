import * as l10n from '@vscode/l10n';
import type { OperationFormDefinition, OperationFormErrors, OperationFormValues } from '../../shared/forms/operationForm';
import { isSafeGitToken } from '../sync/pullOptions';

/** The arguments of one push of every branch of a stack: all of them update or none does. */
export function pushStackArgs(remote: string, branches: readonly string[], force: boolean): string[] {
  if (!isSafeGitToken(remote)) {
    throw new Error(l10n.t('Choose a remote name to push to.'));
  }
  for (const branch of branches) {
    if (!isSafeGitToken(branch)) {
      throw new Error(l10n.t('Choose a branch name to push.'));
    }
  }
  return ['push', '--atomic', ...(force ? ['--force-with-lease'] : []), '--', remote, ...branches.map((branch) => `refs/heads/${branch}:refs/heads/${branch}`)];
}

export function pushStackForm(branches: readonly string[], remotes: readonly string[], defaultRemote: string): OperationFormDefinition {
  return {
    title: l10n.t('Push Stack'),
    submitLabel: l10n.t('Push'),
    values: { remote: defaultRemote, force: true },
    fields: [
      {
        id: 'remote', type: 'text', label: l10n.t('Remote'), required: true,
        description: l10n.t('Push {0} branches in one push: {1}.', branches.length, branches.join(', ')),
        suggestions: remotes.map((value) => ({ value })),
      },
      {
        id: 'force', type: 'checkbox', label: l10n.t('Force'),
        description: l10n.t('Replace a branch that was rebased, unless someone else has pushed to it'),
      },
    ],
  };
}

export function validatePushStackForm(remotes: readonly string[], values: OperationFormValues): OperationFormErrors {
  return remotes.includes(String(values.remote)) ? {} : { remote: l10n.t('Choose a configured remote.') };
}
