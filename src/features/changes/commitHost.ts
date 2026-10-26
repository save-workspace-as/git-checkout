import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { CommitService } from './commitService';
import type { WorkingTreeService } from './workingTreeService';
import { addRecentCommitMessage, getRecentCommitMessages } from './recentCommitMessages';

export async function runCommitFlow(
  context: vscode.ExtensionContext,
  repoRoot: string,
  commitService: CommitService,
  workingTree: WorkingTreeService,
): Promise<boolean> {
  const staged = await workingTree.hasStagedChanges(repoRoot);
  if (!staged) {
    const open = await vscode.window.showWarningMessage(
      l10n.t('Nothing is staged to commit. Stage changes in Source Control or the terminal.'),
      l10n.t('Open Source Control'),
    );
    if (open === l10n.t('Open Source Control')) {
      await vscode.commands.executeCommand('workbench.view.scm');
    }
    return false;
  }

  let gpg = await commitService.getGpgsign(repoRoot);
  const template = await commitService.loadCommitTemplate(repoRoot);
  const logSubjects = await commitService.loadRecentSubjects(repoRoot, 15);
  const stored = getRecentCommitMessages(context);
  const recent = [...new Set([...stored, ...logSubjects])].slice(0, 20);

  let defaultMessage = template;
  if (recent.length > 0) {
    const pick = await vscode.window.showQuickPick(
      [
        { label: l10n.t('Type a new message'), description: l10n.t('Skip recent messages') },
        ...recent.map((label) => ({ label })),
      ],
      { placeHolder: l10n.t('Recent commit messages (optional)') },
    );
    if (!pick) {
      return false;
    }
    if (pick.label !== l10n.t('Type a new message')) {
      defaultMessage = pick.label;
    }
  }

  const message = await vscode.window.showInputBox({
    prompt: l10n.t('Commit message'),
    value: defaultMessage,
    validateInput: (v) => (v.trim() ? undefined : l10n.t('Message is required')),
  });
  if (!message?.trim()) {
    return false;
  }

  let amend = false;
  while (true) {
    const action = await vscode.window.showQuickPick(
      [
        { label: l10n.t('Commit'), id: 'commit' },
        { label: l10n.t('Amend commit'), id: 'amend' },
        {
          label: gpg
            ? l10n.t('Toggle commit signing (currently on)')
            : l10n.t('Toggle commit signing (currently off)'),
          id: 'gpg',
        },
        { label: l10n.t('Cancel'), id: 'cancel' },
      ],
      { placeHolder: l10n.t('Choose commit action') },
    );
    if (!action || action.id === 'cancel') {
      return false;
    }
    if (action.id === 'gpg') {
      gpg = !gpg;
      await commitService.setGpgsign(repoRoot, gpg);
      continue;
    }
    amend = action.id === 'amend';
    break;
  }

  return commitStaged(context, repoRoot, commitService, message, amend);
}

/**
 * Commits what is staged. An amend of a commit already on the upstream asks first, since it rewrites
 * history others may have. Returns false when the user backs out.
 */
export async function commitStaged(
  context: vscode.ExtensionContext,
  repoRoot: string,
  commitService: CommitService,
  message: string,
  amend: boolean,
): Promise<boolean> {
  if (amend) {
    const pushed = await commitService.isHeadPushedToUpstream(repoRoot);
    if (pushed) {
      const override = await vscode.window.showWarningMessage(
        l10n.t('HEAD matches the upstream branch. Amend rewrites a commit that may already be on the remote.'),
        { modal: true },
        l10n.t('Amend anyway'),
      );
      if (override !== l10n.t('Amend anyway')) {
        return false;
      }
    }
  }

  await commitService.commit(repoRoot, message.trim(), amend);
  await addRecentCommitMessage(context, message.trim());
  return true;
}
