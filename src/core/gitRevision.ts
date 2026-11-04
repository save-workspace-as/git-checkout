import * as l10n from '@vscode/l10n';

/**
 * A revision (hash, branch, tag or an expression such as `HEAD~3`) as an argument for Git, trimmed. Git reads a leading
 * dash as an option, so a typed value such as `--help` or `-n1` would change what the command does instead of naming a
 * commit. No revision starts with a dash, so it is refused.
 */
export function revisionArg(value: string): string {
  const revision = value.trim();
  if (revision.startsWith('-')) {
    throw new Error(l10n.t('Not a valid revision: {0}', revision));
  }
  return revision;
}
