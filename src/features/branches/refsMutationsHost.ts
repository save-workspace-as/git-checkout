import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { executeAddRemote, testRemoteUrl, validateRemoteUrl } from '../sync/addRemote';
import { executeBranchCreate, validateBranchName } from './branchCreate';
import { executeBranchRename, readBranchUpstream } from './branchRename';
import { isSafeGitToken } from '../sync/pullOptions';
import type { GitCli } from '../../core/gitCli';
import { GitCliError } from '../../core/gitCliError';
import { annotatedTagArgs, formatSigningFailure, isGitConfigTrue } from '../signing/signingDiagnostics';
import type { BranchCreateRequest } from '../../shared/branches/branchCreate';
import type { BranchRenameRequest } from '../../shared/branches/branchRename';
import type { AddRemoteRequest, RefsMutateOp } from '../../shared/branches/refsProtocol';
import type { OperationFormErrors } from '../../shared/forms/operationForm';
import { createLogger } from '../../log';
import { addRemoteInForm } from '../sync/addRemoteHost';
import { createBranchInForm, initialBranchCheckout, readBranchNameSeparator, readBranchWhitespaceReplacement } from './branchCreateHost';
import type { ShowOperationForm } from '../../panel/operationFormController';
import {
  branchDeleteForm,
  branchRenameForm,
  remoteBranchDeleteForm,
  tagCreateForm,
  validateBranchRenameForm,
  validateTagForm,
} from '../../panel/operationForms';

const log = createLogger('refs');

export async function runRefsMutation(
  cli: GitCli,
  mutate: RefsMutateOp,
  headRef: string | null,
  defaultStartRef: string,
  showOperationForm: ShowOperationForm,
): Promise<boolean> {
  try {
    switch (mutate.op) {
      case 'branchCreate':
        return await createBranch(cli, mutate.startRef ?? defaultStartRef, headRef, mutate.request, showOperationForm);
      case 'branchDelete':
        return await deleteBranch(cli, mutate.name, headRef, showOperationForm);
      case 'remoteBranchDelete':
        return await deleteRemoteBranch(cli, mutate.name, showOperationForm);
      case 'branchRename':
        return await renameBranch(cli, mutate.name, mutate.request, showOperationForm);
      case 'tagCreateLight':
        return await createTag(cli, mutate.objectRef ?? defaultStartRef, false, showOperationForm);
      case 'tagCreateAnnotated':
        return await createTag(cli, mutate.objectRef ?? defaultStartRef, true, showOperationForm);
      case 'tagDelete':
        return await deleteTag(cli, mutate.name);
      case 'remoteAdd':
        return await addRemote(cli, mutate.request, showOperationForm);
      case 'remoteEdit':
        return await editRemote(cli, mutate.name, showOperationForm);
      case 'remoteRemove':
        return await removeRemote(cli, mutate.name);
      case 'branchSetUpstream':
      case 'branchUnsetUpstream':
        return false;
    }
  } catch (error) {
    const message =
      error instanceof GitCliError ? `${error.code}: ${error.message}` : String(error);
    log.error(`${mutate.op} failed: ${message}`, error);
    const remediation = formatSigningFailure(error);
    if (remediation) {
      log.error(remediation);
      const choice = await vscode.window.showErrorMessage(message, l10n.t('Show Output'));
      if (choice === l10n.t('Show Output')) {
        await vscode.commands.executeCommand('gitCheckout.showOutput');
      }
      return false;
    }
    void vscode.window.showErrorMessage(message);
    return false;
  }
}

async function createBranch(
  cli: GitCli,
  startRef: string,
  currentBranch: string | null,
  request: BranchCreateRequest | undefined,
  showOperationForm: ShowOperationForm,
): Promise<boolean> {
  if (!request) {
    return createBranchInForm(showOperationForm, cli, {
      currentBranch,
      startRef,
      separator: readBranchNameSeparator(),
      whitespaceReplacement: readBranchWhitespaceReplacement(),
      checkout: initialBranchCheckout(),
    });
  }
  await executeBranchCreate(cli, request);
  return true;
}

async function deleteBranch(
  cli: GitCli,
  name: string,
  headRef: string | null,
  showOperationForm: ShowOperationForm,
): Promise<boolean> {
  if (headRef && name === headRef) {
    void vscode.window.showWarningMessage(l10n.t('Cannot delete the current branch ({0}).', name));
    return false;
  }
  const upstream = await readBranchUpstream(cli, name);
  let deleted = false;
  await showOperationForm(branchDeleteForm(name, upstream), {
    validate: () => ({}),
    submit: async (values) => {
      try {
        await cli.execWrite(['branch', '-d', name], { showErrorToast: false });
      } catch (error) {
        log.warn(`safe branch delete failed for ${name}; offering force delete`, error);
        const force = await vscode.window.showWarningMessage(
          l10n.t('Branch "{0}" is not fully merged. Force delete?', name),
          { modal: true },
          l10n.t('Force delete'),
        );
        if (force !== l10n.t('Force delete')) {
          return false;
        }
        await cli.execWrite(['branch', '-D', name], { showErrorToast: true });
      }
      if (upstream && values.deleteRemote === true) {
        await cli.execWrite(
          ['push', upstream.remote, '--delete', upstream.branch],
          { showErrorToast: true, network: true },
        );
      }
      deleted = true;
      return true;
    },
  });
  return deleted;
}

async function deleteRemoteBranch(
  cli: GitCli,
  name: string,
  showOperationForm: ShowOperationForm,
): Promise<boolean> {
  const separator = name.indexOf('/');
  const remote = name.slice(0, separator);
  const branch = name.slice(separator + 1);
  if (separator <= 0 || !isSafeGitToken(remote) || !isSafeGitToken(branch)) {
    void vscode.window.showWarningMessage(l10n.t('Choose a valid upstream branch.'));
    return false;
  }
  let deleted = false;
  await showOperationForm(remoteBranchDeleteForm(name), {
    validate: () => ({}),
    submit: async () => {
      await cli.execWrite(['push', remote, '--delete', branch], {
        showErrorToast: true,
        network: true,
      });
      await cli.execWrite(['update-ref', '-d', `refs/remotes/${remote}/${branch}`], {
        showErrorToast: true,
      });
      deleted = true;
      return true;
    },
  });
  return deleted;
}

async function renameBranch(
  cli: GitCli,
  oldName: string,
  request: BranchRenameRequest | undefined,
  showOperationForm: ShowOperationForm,
): Promise<boolean> {
  const oldProblem = validateBranchName(oldName);
  if (oldProblem) {
    void vscode.window.showWarningMessage(oldProblem);
    return false;
  }
  const upstream = request && !request.renameRemote ? null : await readBranchUpstream(cli, oldName);
  let resolved = request;
  if (!resolved) {
    await showOperationForm(branchRenameForm(oldName, upstream, readBranchWhitespaceReplacement()), {
      validate: (values) => validateBranchRenameForm(values, oldName),
      submit: async (values) => {
        resolved = { name: String(values.name).trim(), renameRemote: values.renameRemote === true };
        return true;
      },
    });
  }
  if (!resolved) {
    return false;
  }
  await executeBranchRename(cli, oldName, resolved, upstream);
  return true;
}

async function createTag(
  cli: GitCli,
  defaultObject: string,
  annotated: boolean,
  showOperationForm: ShowOperationForm,
): Promise<boolean> {
  let sign = annotated && await readTagGpgSign(cli);
  return showOperationForm(tagCreateForm(defaultObject, annotated), {
    validate: validateTagForm,
    async submit(values) {
      const name = String(values.name).trim();
      const target = String(values.objectRef).trim();
      const args = annotated
        ? annotatedTagArgs(name, String(values.message).trim(), target, sign)
        : ['tag', name, ...(target && target !== 'HEAD' ? [target] : [])];
      try {
        await cli.execWrite(args, { showErrorToast: true });
        if (annotated && values.pushAllRemotes === true) {
          const remotes = (await cli.execRead(['remote'])).stdout
            .split(/\r?\n/)
            .map((remote) => remote.trim())
            .filter(Boolean);
          for (const remote of remotes) {
            await cli.execWrite(['push', remote, '--tags'], { showErrorToast: true, network: true });
          }
        }
      } catch (error) {
        const remediation = formatSigningFailure(error);
        if (remediation) {
          log.error(remediation, error);
          const choice = await vscode.window.showErrorMessage(l10n.t('Tag signing failed.'), l10n.t('Show Output'));
          if (choice === l10n.t('Show Output')) {
            await vscode.commands.executeCommand('gitCheckout.showOutput');
          }
        }
        throw error;
      }
      return true;
    },
  });
}

async function readTagGpgSign(cli: GitCli): Promise<boolean> {
  try {
    const result = await cli.execRead(['config', '--get', 'tag.gpgSign']);
    return isGitConfigTrue(result.stdout);
  } catch (error) {
    if (error instanceof GitCliError && error.code === 'ExitCode' && error.exitCode === 1) {
      // `git config --get` exits 1 when the key is unset.
      log.debug('tag.gpgSign is not configured', error);
      return false;
    }
    throw error;
  }
}

async function deleteTag(cli: GitCli, name: string): Promise<boolean> {
  const confirm = await vscode.window.showWarningMessage(
    l10n.t('Delete tag "{0}"?', name),
    { modal: true },
    l10n.t('Delete'),
  );
  if (confirm !== l10n.t('Delete')) {
    return false;
  }
  await cli.execWrite(['tag', '-d', name], { showErrorToast: true });
  return true;
}

async function addRemote(
  cli: GitCli, request: AddRemoteRequest | undefined, showOperationForm: ShowOperationForm,
): Promise<boolean> {
  if (!request) {
    return addRemoteInForm(showOperationForm, cli);
  }
  await executeAddRemote(cli, request);
  return true;
}

async function removeRemote(cli: GitCli, name: string): Promise<boolean> {
  const confirm = await vscode.window.showWarningMessage(
    l10n.t('Remove remote "{0}"?', name),
    { modal: true },
    l10n.t('Remove'),
  );
  if (confirm !== l10n.t('Remove')) {
    return false;
  }
  await cli.execWrite(['remote', 'remove', name], { showErrorToast: true });
  return true;
}

async function editRemote(cli: GitCli, name: string, showOperationForm: ShowOperationForm): Promise<boolean> {
  const result = await cli.execRead(['remote', 'get-url', name]);
  const url = result.stdout.trim();
  let edited = false;
  await showOperationForm({
    title: l10n.t('Edit Remote'),
    submitLabel: l10n.t('Save'),
    values: { name, url },
    fields: [
      { id: 'name', type: 'text', label: l10n.t('Remote'), required: true, readOnly: true,
        description: l10n.t('The name of this remote.') },
      { id: 'url', type: 'text', label: l10n.t('Repository URL'), required: true,
        description: l10n.t('Change the URL of this remote.'),
        placeholder: l10n.t('Git repository URL'), pickLabel: l10n.t('Test connection') },
    ],
  }, {
    validate: (values): OperationFormErrors => {
      const problem = validateRemoteUrl(String(values.url));
      if (problem) { return { url: problem }; }
      return {};
    },
    async pick(_field, values) {
      const problem = await testRemoteUrl(cli, String(values.url));
      if (problem) { throw new Error(problem); }
      void vscode.window.showInformationMessage(l10n.t('The remote URL is reachable'));
      return undefined;
    },
    async submit(values) {
      const updatedUrl = String(values.url).trim();
      await cli.execWrite(['remote', 'set-url', name, updatedUrl], { showErrorToast: true });
      edited = true;
      return true;
    },
  });
  return edited;
}
