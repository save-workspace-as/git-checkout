import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { getGitCliRegistry } from '../core/gitCliRegistry';
import { getGitExtensionService } from '../core/gitExtensionServiceState';
import { sameWorktreePath } from '../features/worktrees/worktreeParser';
import { createLogger } from '../log';
import {
  customCommandNeedsRepo,
  customCommandVarKeys,
  expandCustomCommand,
  parseCustomCommands,
  parseOpenableUrl,
  type CustomCommandDefinition,
  type CustomCommandVar,
  type CustomCommandVars,
} from './customCommands';
import { fsPathsFromCommandArgs, repoRootContaining, toRepoRelativePosix } from './workspacePaths';

const log = createLogger('custom-commands');

function promptFor(variable: CustomCommandVar): string {
  switch (variable) {
    case 'branch':
      return l10n.t('Branch name');
    case 'file':
      return l10n.t('File path relative to the repository');
    case 'submodule':
      return l10n.t('Submodule path');
    case 'url':
      return l10n.t('URL');
    case 'repo':
      return l10n.t('Repository path');
    case 'sha':
      return l10n.t('Commit hash');
  }
}

function configuredCommands(): CustomCommandDefinition[] {
  return parseCustomCommands(vscode.workspace.getConfiguration('gitCheckout').get('customCommands'));
}

export async function runCustomCommand(
  preset?: CustomCommandDefinition,
  arg?: unknown,
  selected?: unknown,
): Promise<void> {
  const commands = configuredCommands();
  let definition = preset;
  if (!definition) {
    if (commands.length === 0) {
      void vscode.window.showInformationMessage(
        l10n.t('No custom commands are configured. Add gitCheckout.customCommands in Settings.'),
      );
      return;
    }
    const pick = await vscode.window.showQuickPick(
      commands.map((command) => ({
        label: command.name,
        description: command.context,
        command,
      })),
      { placeHolder: l10n.t('Custom command') },
    );
    if (!pick) {
      return;
    }
    definition = pick.command;
  }

  const gitService = getGitExtensionService();
  const roots = gitService?.getRepositories().map((repo) => repo.rootUri.fsPath) ?? [];
  const hintedPath = fsPathsFromCommandArgs(arg, selected)[0];
  const repoRoot = repoRootContaining(roots, hintedPath);
  if (customCommandNeedsRepo(definition) && !repoRoot) {
    void vscode.window.showWarningMessage(
      hintedPath ? l10n.t('That path is not inside an open Git repository.') : l10n.t('No Git repository is open.'),
    );
    return;
  }

  const vars = await collectVars(definition, repoRoot, hintedPath);
  if (!vars) {
    return;
  }

  const expanded = expandCustomCommand(definition.command, vars, definition.context === 'url');
  log.info(`running custom command ${definition.name}`);
  if (definition.context === 'url') {
    const url = parseOpenableUrl(expanded);
    if (!url) {
      void vscode.window.showErrorMessage(l10n.t('Custom URL command did not expand to an http(s) URL.'));
      return;
    }
    const opened = await vscode.env.openExternal(vscode.Uri.parse(url));
    if (!opened) {
      void vscode.window.showWarningMessage(l10n.t('Could not open the custom command URL.'));
    }
    return;
  }

  if (!repoRoot) {
    void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
    return;
  }
  const terminal = vscode.window.createTerminal({
    name: l10n.t('Git Checkout: {0}', definition.name),
    cwd: vscode.Uri.file(repoRoot),
  });
  terminal.show();
  terminal.sendText(expanded, true);
}

async function collectVars(
  definition: CustomCommandDefinition,
  repoRoot: string | null,
  hintedPath: string | undefined,
): Promise<CustomCommandVars | undefined> {
  const vars: CustomCommandVars = {};
  if (repoRoot) {
    vars.repo = repoRoot;
    const repository = getGitExtensionService()
      ?.getRepositories()
      .find((repo) => sameWorktreePath(repo.rootUri.fsPath, repoRoot));
    const branch = repository?.state.HEAD?.name;
    if (branch) {
      vars.branch = branch;
    }
  }
  if (repoRoot && hintedPath) {
    const relative = toRepoRelativePosix(repoRoot, hintedPath);
    if (relative) {
      vars.file = relative;
      vars.submodule = relative;
    }
  }

  const keys = customCommandVarKeys(definition);
  if (repoRoot && keys.includes('sha') && !vars.sha) {
    vars.sha = (await readHeadSha(repoRoot)) ?? undefined;
  }

  for (const key of keys) {
    if (vars[key]) {
      continue;
    }
    const entered = await vscode.window.showInputBox({
      prompt: promptFor(key),
      ignoreFocusOut: true,
    });
    const trimmed = entered?.trim();
    if (!trimmed) {
      return undefined;
    }
    vars[key] = trimmed;
  }
  return vars;
}

async function readHeadSha(repoRoot: string): Promise<string | null> {
  try {
    return await getGitCliRegistry().getOrCreate(repoRoot).revParseShortHead();
  } catch (error) {
    log.warn('could not read HEAD for a custom command', error);
    return null;
  }
}
