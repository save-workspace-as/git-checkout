import * as l10n from '@vscode/l10n';

/** One line of a branch's reflog, newest first. */
export interface ReflogEntry {
  sha: string;
  /** What Git wrote: `commit (amend): fix typo`, `reset: moving to HEAD~2`, `rebase (finish): …`. */
  message: string;
}

export interface UndoableOperation {
  /** The operation in the person's words, such as "Amend". */
  label: string;
  /** What Git recorded, for the person who wants the detail. */
  message: string;
  currentSha: string;
  previousSha: string;
}

/** Reads `git reflog show --format=%H%x00%gs`. */
export function parseReflog(stdout: string): ReflogEntry[] {
  const entries: ReflogEntry[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const [sha, ...rest] = line.split('\0');
    if (/^[0-9a-f]{40,64}$/.test(sha ?? '')) {
      entries.push({ sha, message: rest.join('\0') });
    }
  }
  return entries;
}

/** The name of what moved the branch, taken from the start of a reflog message. */
export function describeReflogMessage(message: string): string {
  const kind = message.split(':')[0].trim().toLowerCase();
  if (kind.startsWith('commit (amend)')) { return l10n.t('Amend'); }
  if (kind.startsWith('commit (merge)') || kind.startsWith('merge')) { return l10n.t('Merge'); }
  if (kind.startsWith('commit (initial)') || kind.startsWith('commit')) { return l10n.t('Commit'); }
  if (kind.startsWith('rebase')) { return l10n.t('Rebase'); }
  if (kind.startsWith('reset')) { return l10n.t('Reset'); }
  if (kind.startsWith('cherry-pick')) { return l10n.t('Cherry-pick'); }
  if (kind.startsWith('revert')) { return l10n.t('Revert'); }
  if (kind.startsWith('pull')) { return l10n.t('Pull'); }
  return l10n.t('Update');
}

/**
 * What moved the branch last, and where it was before. `undefined` when the branch has only been
 * created: there is nothing earlier to go back to.
 */
export function lastUndoableOperation(entries: ReflogEntry[]): UndoableOperation | undefined {
  const [latest, previous] = entries;
  if (!latest || !previous || latest.message.startsWith('branch: Created')) {
    return undefined;
  }
  return {
    label: describeReflogMessage(latest.message),
    message: latest.message,
    currentSha: latest.sha,
    previousSha: previous.sha,
  };
}
