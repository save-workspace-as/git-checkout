import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

import { runCustomCommand } from '../extensibility/customCommandHost';
import { parseCustomCommands } from '../extensibility/customCommands';
import { buildQuickLaunchItems, type QuickLaunchItem } from '../extensibility/quickLaunchItems';

export interface QuickLaunchHost {
  /** Local branch or tag names of the active repository. */
  refNames(kind: 'branch' | 'tag'): Promise<string[]>;
  repoRoot(): string | null;
}

export async function showGitCheckoutQuickLaunch(host: QuickLaunchHost): Promise<void> {
  const customCommands = parseCustomCommands(
    vscode.workspace.getConfiguration('gitCheckout').get('customCommands'),
  );
  const pick = await vscode.window.showQuickPick(buildQuickLaunchItems(customCommands, vscode.env.remoteName !== undefined), {
    placeHolder: l10n.t('Command'),
  });
  if (!pick) {
    return;
  }
  if (pick.customCommand) {
    await runCustomCommand(pick.customCommand);
    return;
  }
  if (!pick.command) {
    return;
  }
  const args = await launchArguments(pick, host);
  if (args) {
    await vscode.commands.executeCommand(pick.command, ...args);
  }
}

/** Arguments for the item's command, or undefined when the user backed out. */
async function launchArguments(item: QuickLaunchItem, host: QuickLaunchHost): Promise<unknown[] | undefined> {
  switch (item.target) {
    case undefined:
      return [];
    case 'repoUri': {
      const root = host.repoRoot();
      return root ? [vscode.Uri.file(root)] : undefined;
    }
    case 'localBranch':
    case 'tag': {
      const kind = item.target === 'tag' ? 'tag' : 'branch';
      const names = await host.refNames(kind);
      const ref = await vscode.window.showQuickPick(names, {
        placeHolder: kind === 'tag' ? l10n.t('Select a tag') : l10n.t('Select a branch'),
      });
      return ref ? [{ id: ref, kind, label: ref, contextValue: kind, ref, children: [] }] : undefined;
    }
  }
}
