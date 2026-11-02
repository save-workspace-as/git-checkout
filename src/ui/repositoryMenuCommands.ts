import * as vscode from 'vscode';

import type { GitCheckoutPanelManager } from '../panel/gitCheckoutPanelManager';
import { REPOSITORY_ACTIONS, repositoryActionCommand } from './repositoryMenuModel';
import type { SidebarNode } from './sidebarTreeModel';

/**
 * Registers the commands behind the repository menus. Run from a repository's row, a command acts on that
 * repository; run from the Repository view, on the selected one.
 */
export function registerRepositoryMenuCommands(context: vscode.ExtensionContext, panel: GitCheckoutPanelManager): void {
  for (const action of REPOSITORY_ACTIONS) {
    context.subscriptions.push(
      vscode.commands.registerCommand(repositoryActionCommand(action.id), async (node?: SidebarNode) => {
        if (node?.repoRoot) {
          await panel.selectRepository(node.repoRoot);
        }
        const root = panel.activeRepoRoot();
        if (!root) {
          return undefined;
        }
        return action.command === 'revealFileInOS'
          ? vscode.commands.executeCommand(action.command, vscode.Uri.file(root))
          : vscode.commands.executeCommand(action.command);
      }),
    );
  }
}
