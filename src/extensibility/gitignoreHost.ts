import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { getGitExtensionService } from '../core/gitExtensionServiceState';
import { createLogger } from '../log';
import {
  GITIGNORE_TEMPLATES,
  gitignorePattern,
  isDirectoryPath,
  writeGitignorePatterns,
} from './gitignoreTemplates';
import { fsPathsFromCommandArgs, repoRootContaining, toRepoRelativePosix } from './workspacePaths';

const log = createLogger('gitignore');

export async function addGitignoreTemplate(): Promise<void> {
  const repoRoot = repoRootContaining(repositoryRoots());
  if (!repoRoot) {
    void vscode.window.showWarningMessage(l10n.t('No Git repository is open.'));
    return;
  }
  const pick = await vscode.window.showQuickPick(
    GITIGNORE_TEMPLATES.map((template) => ({
      label: template.label,
      description: template.id,
      template,
    })),
    { placeHolder: l10n.t('.gitignore template') },
  );
  if (!pick) {
    return;
  }
  await applyPatterns(repoRoot, pick.template.patterns);
}

export async function addToGitignore(arg?: unknown, selected?: unknown): Promise<void> {
  const fsPaths = fsPathsFromCommandArgs(arg, selected);
  const repoRoot = repoRootContaining(repositoryRoots(), fsPaths[0]);
  if (!repoRoot) {
    void vscode.window.showWarningMessage(
      fsPaths.length > 0 ? l10n.t('That path is not inside an open Git repository.') : l10n.t('No Git repository is open.'),
    );
    return;
  }

  let patterns: string[] | undefined;
  try {
    patterns = await patternsToAdd(repoRoot, fsPaths);
  } catch (error) {
    log.warn('could not update .gitignore', error);
    void vscode.window.showErrorMessage(l10n.t('Could not update .gitignore.'));
    return;
  }
  if (!patterns) {
    return;
  }
  await applyPatterns(repoRoot, patterns);
}

function repositoryRoots(): string[] {
  return getGitExtensionService()?.getRepositories().map((repo) => repo.rootUri.fsPath) ?? [];
}

async function patternsToAdd(repoRoot: string, fsPaths: readonly string[]): Promise<string[] | undefined> {
  if (fsPaths.length === 0) {
    const entered = await vscode.window.showInputBox({
      prompt: l10n.t('Pattern to add to .gitignore'),
      placeHolder: l10n.t('*.log'),
      ignoreFocusOut: true,
    });
    const trimmed = entered?.trim();
    return trimmed ? [trimmed] : undefined;
  }

  const patterns: string[] = [];
  for (const fsPath of fsPaths) {
    const relative = toRepoRelativePosix(repoRoot, fsPath);
    if (!relative) {
      continue;
    }
    patterns.push(gitignorePattern(relative, await isDirectoryPath(fsPath)));
  }
  if (patterns.length === 0) {
    void vscode.window.showWarningMessage(l10n.t('That path is not inside an open Git repository.'));
    return undefined;
  }
  return patterns;
}

async function applyPatterns(repoRoot: string, patterns: readonly string[]): Promise<void> {
  try {
    const added = await writeGitignorePatterns(repoRoot, patterns);
    if (added.length === 0) {
      void vscode.window.showInformationMessage(l10n.t('Those patterns are already in .gitignore.'));
      return;
    }
    void vscode.window.showInformationMessage(l10n.t('Added to .gitignore: {0}', added.join(', ')));
  } catch (error) {
    log.warn('could not update .gitignore', error);
    void vscode.window.showErrorMessage(l10n.t('Could not update .gitignore.'));
  }
}
