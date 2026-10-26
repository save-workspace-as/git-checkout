import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { GitFlowInitState, GitFlowRunResult, GitFlowService } from './gitFlowService';
import {
  parseGitFlowRequest,
  validateGitFlowRequest,
  type GitFlowAction,
  type GitFlowKind,
  type GitFlowRequest,
} from './gitFlowGuide';
import { formatSigningFailure } from '../signing/signingDiagnostics';
import { GitCliError } from '../../core/gitCliError';
import { createLogger } from '../../log';
import type { ShowOperationForm } from '../../panel/operationFormController';
import { gitFlowInitForm, gitFlowInitFromValues, validateGitFlowInitForm } from '../../panel/operationForms';

const log = createLogger('git-flow');

interface FlowPick extends vscode.QuickPickItem {
  action: GitFlowAction;
  flowKind?: GitFlowKind;
}

const FLOWS: FlowPick[] = [
  { label: l10n.t('Start feature'), action: 'start', flowKind: 'feature' },
  { label: l10n.t('Finish feature'), action: 'finish', flowKind: 'feature' },
  { label: l10n.t('Publish feature'), action: 'publish', flowKind: 'feature' },
  { label: l10n.t('Start release'), action: 'start', flowKind: 'release' },
  { label: l10n.t('Finish release'), action: 'finish', flowKind: 'release' },
  { label: l10n.t('Publish release'), action: 'publish', flowKind: 'release' },
  { label: l10n.t('Start hotfix'), action: 'start', flowKind: 'hotfix' },
  { label: l10n.t('Finish hotfix'), action: 'finish', flowKind: 'hotfix' },
  { label: l10n.t('Publish hotfix'), action: 'publish', flowKind: 'hotfix' },
];

/** Shows the Gitflow Init form and sets git-flow up when it is submitted. */
export async function initGitFlowInForm(
  showOperationForm: ShowOperationForm,
  service: GitFlowService,
  repoRoot: string,
  state: GitFlowInitState,
): Promise<GitFlowRunResult | undefined> {
  let result: GitFlowRunResult | undefined;
  await showOperationForm(gitFlowInitForm(state.defaults, state.branchNames), {
    validate: (values) => validateGitFlowInitForm(values, state.branchNames),
    async submit(values) {
      result = await service.initialize(repoRoot, gitFlowInitFromValues(values));
      void vscode.window.showInformationMessage(result.message);
      return true;
    },
  });
  return result;
}

export async function executeGitFlow(
  service: GitFlowService,
  repoRoot: string,
  arg: unknown,
  showOperationForm: ShowOperationForm,
): Promise<GitFlowRunResult | undefined> {
  const parsed = parseGitFlowRequest(arg);
  if (parsed) {
    const problem = validateGitFlowRequest(parsed);
    if (problem) {
      void vscode.window.showWarningMessage(problem);
      return undefined;
    }
    return runRequest(service, repoRoot, parsed, false);
  }

  const state = await service.readInitState(repoRoot);
  if (!state.initialized) {
    return initGitFlowInForm(showOperationForm, service, repoRoot, state);
  }

  const pick = await vscode.window.showQuickPick(FLOWS, {
    placeHolder: l10n.t('Git-flow'),
  });
  if (!pick) {
    return undefined;
  }
  const entered = await vscode.window.showInputBox({
    prompt: l10n.t('{0} name', pick.flowKind ?? ''),
    validateInput: (value) =>
      validateGitFlowRequest({ action: pick.action, kind: pick.flowKind, name: value }) ?? undefined,
  });
  if (!entered) {
    return undefined;
  }
  const name = entered.trim();
  return runRequest(
    service,
    repoRoot,
    { action: pick.action, kind: pick.flowKind, name },
    true,
  );
}

async function runRequest(
  service: GitFlowService,
  repoRoot: string,
  request: GitFlowRequest,
  interactive: boolean,
): Promise<GitFlowRunResult> {
  try {
    const result = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: l10n.t('Git Checkout: Git Flow'),
        cancellable: true,
      },
      (progress, token) => {
        progress.report({ message: labelFor(request) });
        return service.run(repoRoot, request, { cancellationToken: token });
      },
    );
    if (!result.available && interactive) {
      const choice = await vscode.window.showErrorMessage(
        l10n.t('git-flow is not installed. The equivalent Git commands are in the Git Checkout output.'),
        l10n.t('Show Output'),
      );
      if (choice === l10n.t('Show Output')) {
        await vscode.commands.executeCommand('gitCheckout.showOutput');
      }
    }
    return result;
  } catch (error) {
    const remediation = formatSigningFailure(error);
    if (remediation) {
      log.error(remediation);
    }
    const message = error instanceof GitCliError ? `${error.code}: ${error.message}` : String(error);
    log.error(`git flow failed: ${message}`, error);
    if (interactive) {
      const choice = remediation
        ? await vscode.window.showErrorMessage(message, l10n.t('Show Output'))
        : await vscode.window.showErrorMessage(message);
      if (choice === l10n.t('Show Output')) {
        await vscode.commands.executeCommand('gitCheckout.showOutput');
      }
    }
    return {
      available: true,
      ran: false,
      version: null,
      commands: [],
      message,
    };
  }
}

function labelFor(request: GitFlowRequest): string {
  if (request.action === 'init') {
    return l10n.t('Initialize');
  }
  const kind = request.kind ?? '';
  const name = request.name ?? '';
  if (kind && name) {
    return l10n.t('{0} {1} {2}', request.action, kind, name);
  }
  if (kind) {
    return l10n.t('{0} {1}', request.action, kind);
  }
  return l10n.t('{0}', request.action);
}
