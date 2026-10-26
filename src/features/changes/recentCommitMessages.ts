import type * as vscode from 'vscode';

const STORAGE_KEY = 'recentCommitMessages';
const MAX_MESSAGES = 20;

export function getRecentCommitMessages(context: vscode.ExtensionContext): string[] {
  return context.globalState.get<string[]>(STORAGE_KEY, []);
}

export async function addRecentCommitMessage(
  context: vscode.ExtensionContext,
  message: string,
): Promise<void> {
  const trimmed = message.trim();
  if (!trimmed) {
    return;
  }
  const current = getRecentCommitMessages(context).filter((m) => m !== trimmed);
  current.unshift(trimmed);
  await context.globalState.update(STORAGE_KEY, current.slice(0, MAX_MESSAGES));
}
