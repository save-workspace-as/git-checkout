import * as l10n from '@vscode/l10n';
import { GitCliError } from '../../core/gitCliError';

export type SigningProblem = 'no-key' | 'pinentry' | 'gpg-missing' | 'sign-failed';

export function isGitConfigTrue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on';
}

export function classifySigningFailure(text: string): SigningProblem | null {
  const lower = text.toLowerCase();
  if (!/gpg|gpgsign|signing key|pinentry/.test(lower)) {
    return null;
  }
  if (/pinentry|inappropriate ioctl|gpg-agent|agent refused|problem with the agent/.test(lower)) {
    return 'pinentry';
  }
  if (/no secret key|secret key not available|no default secret key/.test(lower)) {
    return 'no-key';
  }
  if (
    /cannot run gpg|gpg: command not found|no such file or directory/.test(lower) &&
    /gpg/.test(lower)
  ) {
    return 'gpg-missing';
  }
  if (/gpg failed to sign|failed to sign the data|signing failed|error: gpg/.test(lower)) {
    return 'sign-failed';
  }
  return null;
}

export function signingRemediation(problem: SigningProblem): string {
  switch (problem) {
    case 'no-key':
      return [
        l10n.t('GPG signing failed because no secret key is available.'),
        l10n.t('Remediation:'),
        l10n.t('- Install GnuPG on the workspace host. This extension does not sign on its own.'),
        l10n.t('- List secret keys: gpg --list-secret-keys --keyid-format LONG'),
        l10n.t('- Point Git at one: git config user.signingkey <KEYID>'),
        l10n.t('- Turn signing off for this repository with git config commit.gpgsign false or git config tag.gpgSign false.'),
      ].join('\n');
    case 'pinentry':
      return [
        l10n.t('GPG signing failed because pinentry could not ask for a passphrase.'),
        l10n.t('Remediation:'),
        l10n.t('- Install a pinentry program that can prompt on the workspace host.'),
        l10n.t('- Point gpg-agent at it (pinentry-program in gpg-agent.conf) and restart gpg-agent.'),
        l10n.t('- In a terminal, export GPG_TTY=$(tty) before signing.'),
        l10n.t('- This extension does not emulate pinentry or cache passphrases.'),
      ].join('\n');
    case 'gpg-missing':
      return [
        l10n.t('GPG signing failed because the gpg program was not found.'),
        l10n.t('Remediation:'),
        l10n.t('- Install GnuPG on the workspace host. Signing uses that gpg binary.'),
        l10n.t('- Check the program Git will run: git config --get gpg.program'),
        l10n.t('- This extension does not emulate signing when gpg is missing.'),
      ].join('\n');
    case 'sign-failed':
      return [
        l10n.t('GPG signing failed.'),
        l10n.t('Remediation:'),
        l10n.t('- Confirm a secret key exists and user.signingkey is set.'),
        l10n.t('- If the Git output mentions pinentry or a passphrase, configure pinentry on the workspace host.'),
        l10n.t('- Disable signing with git config commit.gpgsign false or git config tag.gpgSign false.'),
        l10n.t('- This extension does not emulate signing locally.'),
      ].join('\n');
  }
}

export function errorText(error: unknown): string {
  if (error instanceof GitCliError) {
    return `${error.message}\n${error.stderr}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/** User-facing output-channel text, or null when the failure is not a signing problem. */
export function formatSigningFailure(error: unknown): string | null {
  const problem = classifySigningFailure(errorText(error));
  if (!problem) {
    return null;
  }
  return signingRemediation(problem);
}

export function annotatedTagArgs(
  name: string,
  message: string,
  objectRef: string | undefined,
  sign: boolean,
): string[] {
  const args = ['tag', '-a', name, '-m', message, sign ? '-s' : '--no-sign'];
  if (objectRef && objectRef !== 'HEAD') {
    args.push(objectRef);
  }
  return args;
}
