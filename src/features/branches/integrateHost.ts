import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { IntegrationService } from './integrationService';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import type { MergeMode, RebaseOptions } from './integrationService';
import { checkMergePreflight } from './mergePreflight';

export async function confirmMergePreflight(
  cliRegistry: GitCliRegistry,
  repoRoot: string,
  ref: string,
): Promise<boolean> {
  const cli = cliRegistry.getOrCreate(repoRoot);
  const preflight = await checkMergePreflight(cli, ref);
  if (!preflight.wouldConflict) {
    return true;
  }

  const preview = preflight.conflictFiles.slice(0, 8).join(', ');
  const more =
    preflight.conflictFiles.length > 8
      ? l10n.t(' (+{0} more)', preflight.conflictFiles.length - 8)
      : '';
  const choice = await vscode.window.showWarningMessage(
    l10n.t(
      'Merge may conflict ({0} files): {1}{2}. Continue?',
      preflight.conflictFiles.length,
      preview,
      more,
    ),
    { modal: true },
    l10n.t('Merge'),
  );
  return choice === l10n.t('Merge');
}

export async function runMergeIntoHead(
  integrationService: IntegrationService,
  cliRegistry: GitCliRegistry,
  repoRoot: string,
  ref: string,
  token?: vscode.CancellationToken,
  options: { mergeMode?: MergeMode; preflightConfirmed?: boolean } = {},
): Promise<void> {
  if (!options.preflightConfirmed && !(await confirmMergePreflight(cliRegistry, repoRoot, ref))) {
    return;
  }
  await integrationService.merge(repoRoot, ref, {
    cancellationToken: token,
    mergeMode: options.mergeMode,
  });
}

export async function runRebaseOnto(
  integrationService: IntegrationService,
  repoRoot: string,
  onto: string,
  token?: vscode.CancellationToken,
  options: Omit<RebaseOptions, 'cancellationToken'> = {},
): Promise<void> {
  await integrationService.rebase(repoRoot, onto, { ...options, cancellationToken: token });
}

export async function promptBranchDropAction(
  source: string,
  target: string,
): Promise<'merge' | 'rebase' | null> {
  const pick = await vscode.window.showQuickPick(
    [
      {
        label: l10n.t('Merge "{0}" into "{1}"', source, target),
        description: l10n.t('Checkout the target, then merge the dropped branch'),
        action: 'merge' as const,
      },
      {
        label: l10n.t('Rebase "{0}" onto "{1}"', source, target),
        description: l10n.t('Checkout the dropped branch, then rebase it onto the target'),
        action: 'rebase' as const,
      },
    ],
    { placeHolder: l10n.t('Merge or rebase') },
  );
  return pick?.action ?? null;
}

export async function promptIntegrateRef(action: 'merge' | 'rebase'): Promise<string | null> {
  const ref = await vscode.window.showInputBox({
    prompt:
      action === 'merge'
        ? l10n.t('Merge branch or ref into HEAD')
        : l10n.t('Rebase current branch onto ref'),
    placeHolder: l10n.t('e.g. main, origin/main'),
    validateInput: (v) => (v.trim() ? undefined : l10n.t('Ref is required')),
  });
  return ref?.trim() ?? null;
}
