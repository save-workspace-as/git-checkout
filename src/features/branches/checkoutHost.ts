import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import type { CheckoutService } from './checkoutService';

export async function promptCheckoutRef(): Promise<string | null> {
  const ref = await vscode.window.showInputBox({
    prompt: l10n.t('Checkout a branch, tag, or revision'),
    placeHolder: l10n.t('e.g. main, origin/main, abc1234'),
    validateInput: (v) => (v.trim() ? undefined : l10n.t('Ref is required')),
  });
  return ref?.trim() ?? null;
}

export async function runCheckoutWithFfPrompt(
  checkoutService: CheckoutService,
  repoRoot: string,
  ref: string,
  token?: vscode.CancellationToken,
  localBranch = false,
): Promise<string | null> {
  const offer = localBranch ? null : await checkoutService.detectFastForward(repoRoot, ref);
  let fastForward = false;
  if (offer) {
    const choice = await vscode.window.showInformationMessage(
      l10n.t('Fast-forward local {0} to {1}?', offer.localBranch, offer.remoteRef),
      l10n.t('Fast-forward'),
      l10n.t('Checkout normally'),
    );
    if (!choice) {
      return null;
    }
    fastForward = choice === l10n.t('Fast-forward');
  }

  return checkoutService.checkout(repoRoot, ref, {
    cancellationToken: token,
    fastForward,
    localBranch,
  });
}
