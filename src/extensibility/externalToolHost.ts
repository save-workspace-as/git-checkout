import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { GitCli } from '../core/gitCli';
import { GitCliError } from '../core/gitCliError';
import { getGitCliRegistry } from '../core/gitCliRegistry';
import { getGitExtensionService } from '../core/gitExtensionServiceState';
import { createLogger } from '../log';
import {
  decideExternalTool,
  pickConfiguredTool,
  type ExternalToolKind,
} from './externalTools';
import { fsPathsFromCommandArgs, repoRootContaining, toRepoRelativePosix } from './workspacePaths';

const log = createLogger('external-tools');

function externalToolEnabled(kind: ExternalToolKind): boolean {
  const key = kind === 'diff' ? 'externalDiff.enabled' : 'externalMerge.enabled';
  return vscode.workspace.getConfiguration('gitCheckout').get<boolean>(key, false) === true;
}

export async function openExternalTool(
  kind: ExternalToolKind,
  arg?: unknown,
  selected?: unknown,
  /** Compare these commits instead of the working tree. */
  revisions?: readonly string[],
): Promise<void> {
  const gitService = getGitExtensionService();
  const roots = gitService?.getRepositories().map((repo) => repo.rootUri.fsPath) ?? [];
  const fsPaths = fsPathsFromCommandArgs(arg, selected);
  const repoRoot = repoRootContaining(roots, fsPaths[0]);
  if (!repoRoot) {
    void vscode.window.showWarningMessage(
      fsPaths.length > 0 ? l10n.t('That path is not inside an open Git repository.') : l10n.t('No Git repository is open.'),
    );
    return;
  }

  const relative: string[] = [];
  for (const fsPath of fsPaths) {
    const repoPath = toRepoRelativePosix(repoRoot, fsPath);
    if (repoPath) {
      relative.push(repoPath);
    }
  }
  if (fsPaths.length > 0 && relative.length === 0) {
    void vscode.window.showWarningMessage(l10n.t('That path is not inside an open Git repository.'));
    return;
  }

  const enabled = externalToolEnabled(kind);
  let configuredTool: string | null = null;
  if (enabled) {
    try {
      configuredTool = await readConfiguredTool(repoRoot, kind);
    } catch (error) {
      log.warn('could not read git tool configuration', error);
      const message =
        error instanceof GitCliError ? error.message : l10n.t('Could not read the Git tool configuration.');
      void vscode.window.showErrorMessage(message);
      return;
    }
  }

  const decision = decideExternalTool({
    kind,
    enabled,
    remoteName: gitService?.getDiagnostics().remoteName ?? null,
    configuredTool,
    paths: relative,
    revisions,
  });
  if (decision.status !== 'ready') {
    void vscode.window.showInformationMessage(decision.message);
    return;
  }
  if (decision.plan.remoteWarning) {
    void vscode.window.showWarningMessage(decision.plan.remoteWarning);
  }

  const gitPath = gitService?.getGitPath();
  if (!gitPath) {
    void vscode.window.showErrorMessage(l10n.t('git.path is unavailable from vscode.git.'));
    return;
  }

  const execution = new vscode.ShellExecution(
    gitPath,
    ['-c', 'core.quotepath=false', ...decision.plan.args],
    { cwd: repoRoot },
  );
  const task = new vscode.Task(
    { type: 'git-checkout' },
    vscode.TaskScope.Workspace,
    kind === 'diff' ? l10n.t('External diff') : l10n.t('External merge'),
    l10n.t('Git Checkout'),
    execution,
  );
  task.presentationOptions = {
    reveal: vscode.TaskRevealKind.Always,
    panel: vscode.TaskPanelKind.Dedicated,
    showReuseMessage: false,
    clear: true,
  };
  try {
    await vscode.tasks.executeTask(task);
    log.info(`started external ${kind} tool`);
  } catch (error) {
    log.warn('external tool task failed', error);
    void vscode.window.showErrorMessage(l10n.t('Could not start the external Git tool.'));
  }
}

async function readConfiguredTool(repoRoot: string, kind: ExternalToolKind): Promise<string | null> {
  const cli = getGitCliRegistry().getOrCreate(repoRoot);
  const prefix = kind === 'diff' ? 'diff' : 'merge';
  const guiTool = await gitConfigValue(cli, `${prefix}.guitool`);
  const tool = await gitConfigValue(cli, `${prefix}.tool`);
  return pickConfiguredTool(guiTool, tool);
}

async function gitConfigValue(cli: GitCli, key: string): Promise<string | null> {
  try {
    const result = await cli.execRead(['config', '--get', key]);
    const value = result.stdout.trim();
    return value || null;
  } catch (error) {
    if (error instanceof GitCliError && error.exitCode === 1) {
      log.debug(`git ${key} is not configured`, error);
      return null;
    }
    throw error;
  }
}
