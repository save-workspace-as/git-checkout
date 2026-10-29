import type { MergeSideDto } from '../conflicts/mergeProtocol';
import type { CommitDiffLineDto } from '../history/commitDetailsProtocol';
import type { WorkingCopyDiffSide, WorkingCopyEntryDto, WorkingCopyFileDiffDto } from './workingCopyProtocol';

/** How the Changes tab lists changes: inside their folders, or as flat paths. */
export type ChangesViewMode = 'tree' | 'list';

export interface ChangesViewOptions {
  mode: ChangesViewMode;
  hideUntracked: boolean;
  showIgnored: boolean;
}

export const DEFAULT_CHANGES_VIEW: ChangesViewOptions = { mode: 'list', hideUntracked: false, showIgnored: false };

/** Restores saved options, ignoring anything missing or of the wrong type. */
export function parseStoredChangesView(value: unknown): ChangesViewOptions {
  const stored = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const mode = stored.mode;
  return {
    mode: mode === 'tree' || mode === 'list' ? mode : DEFAULT_CHANGES_VIEW.mode,
    hideUntracked: stored.hideUntracked === true,
    showIgnored: stored.showIgnored === true,
  };
}

/** The changes to list: untracked ones can be hidden; ignored ones are only present when asked for. */
export function filterChangeEntries(
  entries: readonly WorkingCopyEntryDto[],
  options: ChangesViewOptions,
): WorkingCopyEntryDto[] {
  return entries.filter((entry) => {
    if (entry.status === 'ignored') {
      return options.showIgnored;
    }
    return !(options.hideUntracked && entry.group === 'untracked');
  });
}

/** Subject lengths past which the commit form warns: `warning` asks to shorten it, `limit` marks it too long. */
export interface SubjectLengthLimits {
  warning: number;
  limit: number;
}

export const DEFAULT_SUBJECT_LIMITS: SubjectLengthLimits = { warning: 50, limit: 70 };

/** How a subject measures against the limits; a limit of 0 or less is off. It never blocks the commit. */
export function subjectLengthLevel(subject: string, limits: SubjectLengthLimits): 'warning' | 'limit' | undefined {
  const length = subject.trim().length;
  if (limits.limit > 0 && length > limits.limit) {
    return 'limit';
  }
  return limits.warning > 0 && length > limits.warning ? 'warning' : undefined;
}

export type ChangesHostMessage =
  | { type: 'changesView'; options: ChangesViewOptions }
  | { type: 'changesSubjectLimits'; limits: SubjectLengthLimits }
  /** The change selected in any of the views; `null` when there are none. */
  | { type: 'changesSelection'; selection: { path: string; side: WorkingCopyDiffSide } | null }
  /** The diff of the selected change. */
  | {
      type: 'changesDiff';
      path: string;
      side: WorkingCopyDiffSide;
      binary: boolean;
      lines: CommitDiffLineDto[];
      error?: string;
      nonText?: WorkingCopyFileDiffDto;
    }
  /** The selected change is a conflicted file: who conflicts, and whether the Merge modal can take it. */
  | {
      type: 'changesConflict';
      path: string;
      side: WorkingCopyDiffSide;
      incoming: MergeSideDto;
      current: MergeSideDto;
      canMerge: boolean;
      /** Whether each side still has the file; one that deleted it does not. */
      incomingExists: boolean;
      currentExists: boolean;
    }
  /** The commit went through: clear the form. */
  | { type: 'changesCommitted' }
  /** A message drafted by the language model for the staged changes. */
  | { type: 'changesGeneratedMessage'; subject: string; description: string }
  /** The model is working on a message, or has finished or given up. */
  | { type: 'changesGenerating'; busy: boolean }
  /** The last commit's message, for amending. */
  | { type: 'changesAmendMessage'; subject: string; description: string }
  /** A keyboard shortcut for the commit form: submit it, submit it and push, or move focus into it. */
  | { type: 'changesShortcut'; action: 'commit' | 'commitAndPush' | 'focusCommit' };

export type ChangesWebviewMessage =
  | { type: 'changesReady' }
  | { type: 'changesActions'; actions: { op: 'stage' | 'unstage' | 'discard'; path: string }[] }
  /** Select a change; an empty path clears the selection. */
  | { type: 'changesSelect'; path: string; side: WorkingCopyDiffSide }
  /** Stage, unstage or discard one hunk, given as a patch built from the diff on screen. */
  | { type: 'changesHunk'; path: string; op: 'stage' | 'unstage' | 'discard'; patch: string }
  | { type: 'changesCommit'; subject: string; description: string; amend: boolean; push?: boolean; pushForm?: boolean }
  | { type: 'changesAmend' }
  | { type: 'changesGenerateMessage' }
  | { type: 'changesOpenFile'; path: string }
  /** Resolve a conflicted file in the Merge modal, or in VS Code's merge editor. */
  | { type: 'changesMergeInCheckout'; path: string }
  | { type: 'changesMergeInEditor'; path: string }
  /** Resolve a conflict that cannot be merged line by line by keeping one side whole. */
  | { type: 'changesMergeTakeSide'; path: string; side: 'incoming' | 'current' };

/** A commit message from the form: the subject, a blank line, then the description. */
export function joinCommitMessage(subject: string, description: string): string {
  const head = subject.trim();
  const body = description.trim();
  return body ? `${head}\n\n${body}` : head;
}

/** The inverse of `joinCommitMessage`, for filling the form from an existing commit. */
export function splitCommitMessage(message: string): { subject: string; description: string } {
  const trimmed = message.replace(/\s+$/, '');
  const newline = trimmed.indexOf('\n');
  if (newline < 0) {
    return { subject: trimmed, description: '' };
  }
  return { subject: trimmed.slice(0, newline).trim(), description: trimmed.slice(newline).trim() };
}

/** Why the form cannot commit, or undefined when it can. An amend may reword with nothing staged. */
export function changesCommitBlocker(
  stagedCount: number,
  subject: string,
  amend: boolean,
): 'nothingStaged' | 'noSubject' | undefined {
  if (stagedCount === 0 && !amend) {
    return 'nothingStaged';
  }
  return subject.trim() ? undefined : 'noSubject';
}
