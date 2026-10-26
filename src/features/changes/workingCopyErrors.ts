import * as l10n from '@vscode/l10n';
import { GitCliError } from '../../core/gitCliError';

/** Maps git failures from stage, unstage, and discard into text a user can act on. */
export function mapWorkingCopyFailure(error: unknown): string {
  const detail =
    error instanceof GitCliError
      ? `${error.stderr}\n${error.message}`
      : error instanceof Error
        ? error.message
        : String(error);
  const lower = detail.toLowerCase();
  if (
    lower.includes('permission denied') ||
    lower.includes('eacces') ||
    lower.includes('operation not permitted')
  ) {
    return l10n.t('Could not update the index because a file is not writable. Check permissions and try again.');
  }
  if (lower.includes('index.lock') || lower.includes('unable to lock')) {
    return l10n.t('Could not lock the index. Wait for the other Git command to finish and try again.');
  }
  if (lower.includes('unmerged') || lower.includes('needs merge') || lower.includes('conflict')) {
    return l10n.t('Could not update the index because the file has conflicts. Resolve the conflicts and try again.');
  }
  if (error instanceof GitCliError && error.code !== 'ExitCode') {
    return `${error.code}: ${error.message}`;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return l10n.t('Could not update the index.');
}
