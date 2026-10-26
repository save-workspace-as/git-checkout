import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';

export async function pickMainlineParent(
  parents: string[],
  action: 'revert' | 'cherry-pick',
): Promise<number | null> {
  if (parents.length <= 1) {
    return 1;
  }

  const items = parents.map((parentSha, index) => ({
    label: l10n.t('Parent {0}', index + 1),
    description: parentSha.slice(0, 8),
    mainline: index + 1,
  }));

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder:
      action === 'revert'
        ? l10n.t('Choose mainline parent to revert')
        : l10n.t('Choose mainline parent to cherry-pick'),
  });
  return pick?.mainline ?? null;
}
