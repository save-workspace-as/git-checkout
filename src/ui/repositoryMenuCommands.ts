import * as vscode from 'vscode';

import type { GitCheckoutPanelManager } from '../panel/gitCheckoutPanelManager';
import { REPOSITORY_ACTIONS, repositoryActionCommand } from './repositoryMenuModel';
import { SIDEBAR_REPO_SLOTS } from './sidebarTreeModel';

/**
 * Registers the commands behind each repository view's dropdown. A command selects the repository
 * its view shows, then runs the existing command, which acts on the selected repository.
 */
export function registerRepositoryMenuCommands(
  context: vscode.ExtensionContext,
  panel: GitCheckoutPanelManager,
  repos: { roots: readonly string[] },
): void {
  for (let slot = 0; slot < SIDEBAR_REPO_SLOTS; slot += 1) {
    for (const action of REPOSITORY_ACTIONS) {
      context.subscriptions.push(
        vscode.commands.registerCommand(repositoryActionCommand(slot, action.id), async () => {
          const root = repos.roots[slot];
          if (!root) {
            return undefined;
          }
          await panel.selectRepository(root);
          return action.command === 'revealFileInOS'
            ? vscode.commands.executeCommand(action.command, vscode.Uri.file(root))
            : vscode.commands.executeCommand(action.command);
        }),
      );
    }
  }
}
