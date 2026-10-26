import * as l10n from '@vscode/l10n';
import { formatDateTime } from '../../shared/history/commitDate';

/**
 * The message of a stash made automatically around another operation, for example
 * "Git Checkout autostash 22 Oct 2026 at 11:34". Git adds the branch ("On main: ...") itself.
 */
export function autoStashMessage(now: Date = new Date()): string {
  return l10n.t('Git Checkout autostash {0}', formatDateTime(now));
}

/** Matches the English message `autoStashMessage` makes, for tests. */
export const AUTO_STASH_MESSAGE_PATTERN = /^Git Checkout autostash \d{1,2} [A-Z][a-z]{2} \d{4} at \d{2}:\d{2}$/;
