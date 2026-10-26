import * as vscode from 'vscode';

import { runCustomCommand } from './customCommandHost';
import { openExternalTool } from './externalToolHost';
import { addGitignoreTemplate, addToGitignore } from './gitignoreHost';

export function registerExtensibilityCommands(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('gitCheckout.runCustomCommand', (arg?: unknown, selected?: unknown) =>
      runCustomCommand(undefined, arg, selected),
    ),
    vscode.commands.registerCommand('gitCheckout.openExternalDiff', (arg?: unknown, selected?: unknown) =>
      openExternalTool('diff', arg, selected),
    ),
    vscode.commands.registerCommand('gitCheckout.openExternalMerge', (arg?: unknown, selected?: unknown) =>
      openExternalTool('merge', arg, selected),
    ),
    vscode.commands.registerCommand('gitCheckout.addGitignoreTemplate', () => addGitignoreTemplate()),
    vscode.commands.registerCommand('gitCheckout.addToGitignore', (arg?: unknown, selected?: unknown) =>
      addToGitignore(arg, selected),
    ),
  );
}
