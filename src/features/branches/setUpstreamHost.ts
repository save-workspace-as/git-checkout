import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { RefsSnapshotDto } from '../../shared/branches/refsProtocol';
import type { ShowOperationForm } from '../../panel/operationFormController';
import { upstreamRefForm, validateUpstreamRefForm } from '../../panel/operationForms';

export async function promptUpstreamRef(
  snapshot: RefsSnapshotDto,
  branchName: string,
  showOperationForm: ShowOperationForm,
): Promise<string | null> {
  const hasRemoteBranches = snapshot.remoteBranches.some((branch) => !branch.name.endsWith('/HEAD'));
  if (!hasRemoteBranches) {
    void vscode.window.showWarningMessage(l10n.t('No remote-tracking branches to use as upstream.'));
    return null;
  }

  const form = upstreamRefForm(snapshot, branchName);
  let upstream: string | null = null;
  await showOperationForm(form, {
    validate: (values) => validateUpstreamRefForm(values, snapshot),
    submit: async (values) => {
      upstream = String(values.upstream).trim();
      return true;
    },
  });
  return upstream;
}
