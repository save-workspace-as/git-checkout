import * as l10n from '@vscode/l10n';
import type { GitHubRepository } from './githubReferences';
import type { CommitDiffLineDto } from './commitDetailsProtocol';
import type { GraphCommitDto } from '../graph/graphProtocol';
import type { WorkingCopyFileDiffDto } from '../changes/workingCopyProtocol';

export const PATH_HISTORY_PAGE_SIZE = 80;

export type PathHistoryScope = 'file' | 'directory' | 'hunk';

export interface PathHistoryRequest {
  scope: PathHistoryScope;
  path: string;
  startLine?: number;
  endLine?: number;
  follow: boolean;
  includeMerges: boolean;
  skip: number;
  limit?: number;
}

export interface CommitTreePathContext {
  webviewSection: 'commitTree';
  commitTreeKind: 'blob' | 'tree';
  path: string;
  revision?: string;
  /** Which file list the row is in; the Tree tab when absent. */
  list?: 'changes' | 'tree';
  /** For a comparison in the Changes list, the older commit. */
  baseRevision?: string;
  /** The file's previous path when the change is a rename. */
  oldPath?: string;
  /** `git diff-tree --name-status` token of the change, in the Changes list. */
  status?: string;
  preventDefaultContextMenuItems: true;
}

export interface HunkHistoryContext {
  webviewSection: 'hunk';
  path: string;
  startLine: number;
  endLine: number;
  preventDefaultContextMenuItems: true;
}

export interface PathHistoryPageDto {
  commits: GraphCommitDto[];
  hasMore: boolean;
  /** Log records consumed, including per-parent copies of a merge. */
  advance: number;
}

export type PathHistoryHostMessage =
  /** Opens the History modal for `path` and clears what it showed before. */
  | {
      type: 'pathHistoryOpen';
      scope: PathHistoryScope;
      path: string;
      title: string;
      canFollow: boolean;
      /** `blame` shows the same commits in the Blame modal, with each line's last commit beside it. */
      mode?: 'history' | 'blame';
      /** A commit to select once the list has it, instead of the newest. */
      select?: string;
    }
  | {
      type: 'pathHistoryMeta';
      summary: string;
      github: GitHubRepository | null;
      follow: boolean;
      includeMerges: boolean;
    }
  | { type: 'pathHistoryPage'; page: PathHistoryPageDto; append: boolean }
  /** The selected commit's change to the path. */
  | {
      type: 'pathHistoryDiff';
      sha: string;
      binary: boolean;
      lines: CommitDiffLineDto[];
      error?: string;
      nonText?: WorkingCopyFileDiffDto;
    }
  /** For the Blame modal: the commit that last changed each line of the selected commit's diff. */
  | { type: 'pathHistoryBlame'; sha: string; shas: string[]; commits: Record<string, BlameCommitDto> }
  /** Select this commit, which the list has now. */
  | { type: 'pathHistorySelectCommit'; sha: string }
  | { type: 'pathHistoryFailed' }
  | { type: 'pathHistoryClose' };

export interface BlameCommitDto {
  author: string;
  authorMail: string;
  authorTime: number;
  summary: string;
}

/** Diff options the History modal's toolbar can change; they are shared with the Changes tab. */
export type PathHistoryViewOption =
  | 'ignoreWhitespace'
  | 'invisibles'
  | 'wrap'
  | 'moreContext'
  | 'lessContext'
  | 'fullFile'
  | 'sideBySide';

/** A button of the diff toolbar: the view options, plus stepping through changes in the Commit tab. */
export type DiffViewOption = PathHistoryViewOption | 'previousChange' | 'nextChange' | 'swapSides';

export type PathHistoryWebviewMessage =
  | { type: 'pathHistoryLoadMore' }
  | { type: 'pathHistorySelect'; sha: string }
  | { type: 'pathHistoryClose' }
  | { type: 'pathHistoryOpenInEditor'; sha: string }
  /** The Blame modal: step back from a line the selected commit changed to the commit that changed it before. */
  | { type: 'pathHistoryBlameBefore'; sha: string; line: number }
  | { type: 'pathHistoryToggle'; option: 'follow' | 'merges' }
  | { type: 'pathHistoryReset' }
  | { type: 'pathHistoryViewOption'; option: PathHistoryViewOption };

export function defaultPathHistoryFollow(scope: PathHistoryScope): boolean {
  return scope === 'file';
}

export function pathHistoryTitle(scope: PathHistoryScope, path: string): string {
  const label =
    scope === 'file'
      ? l10n.t('File History')
      : scope === 'directory'
        ? l10n.t('Folder History')
        : l10n.t('Hunk History');
  return l10n.t('{0}: {1}', label, path);
}

export function pathHistorySummary(request: {
  scope: PathHistoryScope;
  follow: boolean;
  includeMerges: boolean;
  startLine?: number;
  endLine?: number;
}): string {
  const parts: string[] = [];
  if (request.scope === 'file') {
    parts.push(request.follow ? l10n.t('Following renames') : l10n.t('Not following renames'));
  }
  if (request.scope === 'hunk' && request.startLine && request.endLine) {
    parts.push(l10n.t('Lines {0}-{1}', request.startLine, request.endLine));
  }
  parts.push(
    request.includeMerges ? l10n.t('Including merge commits') : l10n.t('Hiding merge commits'),
  );
  return parts.join(' · ');
}

export function resetFileConfirmMessage(path: string, revision: string): string {
  return l10n.t(
    'Reset {0} to {1}? This replaces the index and working tree copy of this file.',
    path,
    revision.slice(0, 7),
  );
}

/** `12,40`, `12-40`, `12:40`, or a single line. */
export function parseHunkLineRange(input: string): { start: number; end: number } | null {
  const trimmed = input.trim();
  const range = /^(\d+)\s*[,:-]\s*(\d+)$/.exec(trimmed);
  const single = /^(\d+)$/.exec(trimmed);
  const start = Number(range?.[1] ?? single?.[1]);
  const end = Number(range?.[2] ?? single?.[1]);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
    return null;
  }
  return start <= end ? { start, end } : { start: end, end: start };
}

/** New-file line range from a unified diff hunk header. */
export function parseHunkHeaderRange(header: string): { start: number; end: number } | null {
  const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(header);
  if (!match) {
    return null;
  }
  const start = Number(match[1]);
  const count = match[2] === undefined ? 1 : Number(match[2]);
  if (!Number.isInteger(start) || start < 1 || !Number.isInteger(count) || count < 0) {
    return null;
  }
  if (count === 0) {
    return { start, end: start };
  }
  return { start, end: start + count - 1 };
}

export function commitTreePathContext(
  path: string,
  kind: 'blob' | 'tree',
  revision?: string,
  extra: Pick<CommitTreePathContext, 'list' | 'baseRevision' | 'oldPath' | 'status'> = {},
): CommitTreePathContext {
  const context: CommitTreePathContext = {
    webviewSection: 'commitTree',
    commitTreeKind: kind,
    path,
    preventDefaultContextMenuItems: true,
  };
  if (revision) {
    context.revision = revision;
  }
  for (const [key, value] of Object.entries(extra)) {
    if (value) {
      (context as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return context;
}

export function hunkHistoryContext(path: string, header: string): HunkHistoryContext | null {
  const range = parseHunkHeaderRange(header);
  if (!range) {
    return null;
  }
  return {
    webviewSection: 'hunk',
    path,
    startLine: range.start,
    endLine: range.end,
    preventDefaultContextMenuItems: true,
  };
}

export function isCommitTreePathContext(value: unknown): value is CommitTreePathContext {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<CommitTreePathContext>;
  return (
    candidate.webviewSection === 'commitTree' &&
    (candidate.commitTreeKind === 'blob' || candidate.commitTreeKind === 'tree') &&
    typeof candidate.path === 'string' &&
    candidate.path.length > 0
  );
}

export function isHunkHistoryContext(value: unknown): value is HunkHistoryContext {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<HunkHistoryContext>;
  return (
    candidate.webviewSection === 'hunk' &&
    typeof candidate.path === 'string' &&
    candidate.path.length > 0 &&
    typeof candidate.startLine === 'number' &&
    typeof candidate.endLine === 'number'
  );
}

/** Longest repo root that contains `fsPath`. A root path itself maps to `.`. */
export function locateRepoFile(
  repoRoots: readonly string[],
  fsPath: string,
): { repoRoot: string; path: string } | undefined {
  const target = fsPath.replace(/\\/g, '/');
  let match: { repoRoot: string; path: string; length: number } | undefined;
  for (const repoRoot of repoRoots) {
    const root = repoRoot.replace(/\\/g, '/').replace(/\/$/, '');
    if (!root || (target !== root && !target.startsWith(`${root}/`))) {
      continue;
    }
    if (match && root.length <= match.length) {
      continue;
    }
    match = {
      repoRoot,
      path: target === root ? '.' : target.slice(root.length + 1),
      length: root.length,
    };
  }
  return match ? { repoRoot: match.repoRoot, path: match.path } : undefined;
}

export function parentRepoPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  if (index <= 0) {
    return '.';
  }
  return normalized.slice(0, index);
}
