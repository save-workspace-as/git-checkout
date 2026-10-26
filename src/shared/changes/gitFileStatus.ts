import type { ConflictScenario } from '../conflicts/conflictProtocol';
import type { WorkingCopyStatusLabel } from './workingCopyProtocol';

/** Normalized Git change state used for colors and icons across UI surfaces. */
export type GitFileStatusHighlight =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflict'
  | 'neutral';

const HIGHLIGHT_PRIORITY: Record<GitFileStatusHighlight, number> = {
  conflict: 6,
  deleted: 5,
  added: 4,
  untracked: 3,
  renamed: 2,
  modified: 1,
  neutral: 0,
};

export function mergeGitFileStatusHighlight(
  current: GitFileStatusHighlight,
  next: GitFileStatusHighlight,
): GitFileStatusHighlight {
  return HIGHLIGHT_PRIORITY[next] > HIGHLIGHT_PRIORITY[current] ? next : current;
}

export function workingCopyStatusHighlight(status: WorkingCopyStatusLabel): GitFileStatusHighlight {
  switch (status) {
    case 'added':
    case 'intent-to-add':
      return 'added';
    case 'deleted':
      return 'deleted';
    case 'renamed':
    case 'copied':
    case 'intent-to-rename':
      return 'renamed';
    case 'untracked':
      return 'untracked';
    case 'conflict':
      return 'conflict';
    case 'modified':
    case 'type-changed':
      return 'modified';
    case 'ignored':
    case 'unknown':
      return 'neutral';
  }
}

/** Maps `git diff-tree --name-status` tokens (for example `M`, `R100`) to a highlight. */
export function gitNameStatusHighlight(status: string): GitFileStatusHighlight {
  switch (status.charAt(0).toUpperCase()) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
    case 'C':
      return 'renamed';
    case 'M':
    case 'T':
      return 'modified';
    case 'U':
      return 'untracked';
    case '!':
      return 'conflict';
    default:
      return 'neutral';
  }
}

/** The one-letter badge for a working-copy change, in `git diff --name-status` style. */
export function workingCopyStatusLetter(status: WorkingCopyStatusLabel): string {
  switch (status) {
    case 'modified':
      return 'M';
    case 'added':
    case 'intent-to-add':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
    case 'intent-to-rename':
      return 'R';
    case 'copied':
      return 'C';
    case 'type-changed':
      return 'T';
    case 'untracked':
      return 'U';
    case 'conflict':
      return '!';
    case 'ignored':
    case 'unknown':
      return '?';
  }
}

export function conflictScenarioHighlight(scenario: ConflictScenario): GitFileStatusHighlight {
  switch (scenario) {
    case 'both-deleted':
    case 'deleted-by-us':
    case 'deleted-by-them':
      return 'deleted';
    case 'both-added':
    case 'added-by-us':
    case 'added-by-them':
      return 'added';
    case 'both-modified':
      return 'conflict';
  }
}

/** Row modifier class shared by webview lists (`git-file-row--modified`, etc.). */
export function gitFileStatusRowClass(highlight: GitFileStatusHighlight): string {
  return highlight === 'neutral' ? 'git-file-row--neutral' : `git-file-row--${highlight}`;
}

/** VS Code theme color id for tree icons and file decorations. */
export function vscodeGitDecorationColorId(highlight: GitFileStatusHighlight): string | undefined {
  switch (highlight) {
    case 'added':
      return 'gitDecoration.addedResourceForeground';
    case 'deleted':
      return 'gitDecoration.deletedResourceForeground';
    case 'untracked':
      return 'gitDecoration.untrackedResourceForeground';
    case 'conflict':
      return 'gitDecoration.conflictingResourceForeground';
    case 'modified':
    case 'renamed':
      return 'gitDecoration.modifiedResourceForeground';
    case 'neutral':
      return undefined;
  }
}

export function changeStatusCodicon(highlight: GitFileStatusHighlight): string {
  switch (highlight) {
    case 'added':
    case 'untracked':
      return 'diff-added';
    case 'deleted':
      return 'diff-removed';
    case 'renamed':
      return 'diff-renamed';
    case 'conflict':
      return 'warning';
    case 'modified':
      return 'diff-modified';
    case 'neutral':
      return 'file';
  }
}
