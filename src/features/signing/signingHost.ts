import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { CommitService } from '../changes/commitService';

export type SigningTarget = 'commit' | 'tag';

export interface SigningToggleRequest {
  target: SigningTarget;
  enabled?: boolean;
}

interface SigningPick extends vscode.QuickPickItem {
  target: SigningTarget;
  enabled: boolean;
}

export function parseSigningToggleRequest(value: unknown): SigningToggleRequest | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const record = value as { target?: unknown; enabled?: unknown };
  if (record.target !== 'commit' && record.target !== 'tag') {
    return null;
  }
  if (record.enabled !== undefined && typeof record.enabled !== 'boolean') {
    return null;
  }
  return {
    target: record.target,
    enabled: typeof record.enabled === 'boolean' ? record.enabled : undefined,
  };
}

export async function executeSigningToggle(
  commitService: CommitService,
  repoRoot: string,
  arg: unknown,
): Promise<boolean | undefined> {
  const parsed = parseSigningToggleRequest(arg);
  if (parsed) {
    const enabled = parsed.enabled ?? !(await current(commitService, repoRoot, parsed.target));
    await commitService.setSigning(repoRoot, parsed.target, enabled);
    return enabled;
  }

  const commitOn = await commitService.getGpgsign(repoRoot);
  const tagOn = await commitService.getTagGpgSign(repoRoot);
  const pick = await vscode.window.showQuickPick<SigningPick>(
    [
      {
        label: commitOn ? l10n.t('Commit signing (on)') : l10n.t('Commit signing (off)'),
        description: l10n.t('commit.gpgsign'),
        target: 'commit',
        enabled: !commitOn,
      },
      {
        label: tagOn ? l10n.t('Tag signing (on)') : l10n.t('Tag signing (off)'),
        description: l10n.t('tag.gpgSign for annotated tags'),
        target: 'tag',
        enabled: !tagOn,
      },
    ],
    { placeHolder: l10n.t('Toggle GPG signing') },
  );
  if (!pick) {
    return undefined;
  }
  await commitService.setSigning(repoRoot, pick.target, pick.enabled);
  const label = pick.target === 'commit' ? l10n.t('Commit') : l10n.t('Tag');
  void vscode.window.showInformationMessage(
    l10n.t('{0} signing is {1}.', label, pick.enabled ? l10n.t('on') : l10n.t('off')),
  );
  return pick.enabled;
}

function current(
  commitService: CommitService,
  repoRoot: string,
  target: SigningTarget,
): Promise<boolean> {
  return target === 'commit'
    ? commitService.getGpgsign(repoRoot)
    : commitService.getTagGpgSign(repoRoot);
}
