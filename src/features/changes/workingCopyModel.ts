import * as l10n from '@vscode/l10n';
import * as path from 'node:path';
import type {
  WorkingCopyEntryDto,
  WorkingCopyFlagDto,
  WorkingCopyGroup,
  WorkingCopyStatusLabel,
} from '../../shared/changes/workingCopyProtocol';
import { GitChangeStatus, type GitChange, type RepositoryState } from '../../core/vscodeGitApi';

const STATUS_LABELS: Record<GitChangeStatus, WorkingCopyStatusLabel> = {
  [GitChangeStatus.INDEX_MODIFIED]: 'modified',
  [GitChangeStatus.INDEX_ADDED]: 'added',
  [GitChangeStatus.INDEX_DELETED]: 'deleted',
  [GitChangeStatus.INDEX_RENAMED]: 'renamed',
  [GitChangeStatus.INDEX_COPIED]: 'copied',
  [GitChangeStatus.MODIFIED]: 'modified',
  [GitChangeStatus.DELETED]: 'deleted',
  [GitChangeStatus.UNTRACKED]: 'untracked',
  [GitChangeStatus.IGNORED]: 'ignored',
  [GitChangeStatus.INTENT_TO_ADD]: 'intent-to-add',
  [GitChangeStatus.INTENT_TO_RENAME]: 'intent-to-rename',
  [GitChangeStatus.TYPE_CHANGED]: 'type-changed',
  [GitChangeStatus.ADDED_BY_US]: 'conflict',
  [GitChangeStatus.ADDED_BY_THEM]: 'conflict',
  [GitChangeStatus.DELETED_BY_US]: 'conflict',
  [GitChangeStatus.DELETED_BY_THEM]: 'conflict',
  [GitChangeStatus.BOTH_ADDED]: 'conflict',
  [GitChangeStatus.BOTH_DELETED]: 'conflict',
  [GitChangeStatus.BOTH_MODIFIED]: 'conflict',
};

export function workingCopyStatusLabel(status: GitChangeStatus): WorkingCopyStatusLabel {
  return STATUS_LABELS[status] ?? 'unknown';
}

export function toRepoRelativePath(repoRoot: string, fsPath: string): string {
  const rel = path.relative(repoRoot, fsPath);
  return rel.split(path.sep).join('/');
}

export function toAbsoluteRepoPath(repoRoot: string, repoRelativePath: string): string {
  return path.join(repoRoot, ...repoRelativePath.split('/'));
}

/** Repo-relative git path. Rejects absolute paths and parent segments; a folder's trailing slash is dropped. */
export function assertRepoRelativePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/(?<=.)\/$/, '');
  const parts = normalized.split('/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')
    || parts.some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(l10n.t('Invalid working-copy path: "{0}".', filePath));
  }
  return normalized;
}

export function buildWorkingCopyEntries(
  repoRoot: string,
  state: Pick<RepositoryState, 'mergeChanges' | 'indexChanges' | 'workingTreeChanges' | 'untrackedChanges'>,
): WorkingCopyEntryDto[] {
  const entries: WorkingCopyEntryDto[] = [];
  // A conflicted file is unmerged in the index, so it has no staged side; it is listed with the unstaged changes.
  for (const change of state.mergeChanges ?? []) {
    entries.push(entryFromChange(repoRoot, change, 'unstaged'));
  }
  for (const change of state.indexChanges ?? []) {
    entries.push(entryFromChange(repoRoot, change, 'staged'));
  }

  const untrackedPaths = new Set<string>();
  for (const change of state.workingTreeChanges ?? []) {
    const untracked =
      change.status === GitChangeStatus.UNTRACKED || change.status === GitChangeStatus.IGNORED;
    const entry = entryFromChange(repoRoot, change, untracked ? 'untracked' : 'unstaged');
    if (entries.some((other) => other.path === entry.path && other.status === 'conflict')) {
      continue;
    }
    if (untracked) {
      untrackedPaths.add(entry.path);
    }
    entries.push(entry);
  }

  for (const change of state.untrackedChanges ?? []) {
    const entry = entryFromChange(repoRoot, change, 'untracked');
    if (untrackedPaths.has(entry.path)) {
      continue;
    }
    entries.push(entry);
  }

  return entries.sort(compareWorkingCopyEntries);
}

/**
 * Paths with merge conflicts, from `git ls-files --stage -z`: an unmerged path has entries at stage 1, 2 or 3.
 * Git reports this the moment the conflict exists, before vscode.git has refreshed its own state.
 */
export function parseUnmergedPaths(stdout: string): Set<string> {
  const paths = new Set<string>();
  for (const record of stdout.split('\0')) {
    const match = /^\d+ [0-9a-f]+ ([123])\t(.+)$/s.exec(record);
    if (match) {
      paths.add(match[2].replace(/\\/g, '/'));
    }
  }
  return paths;
}

/** Marks the unmerged paths as conflicts, replacing whatever else was listed for them. */
export function withConflicts(entries: readonly WorkingCopyEntryDto[], unmerged: ReadonlySet<string>): WorkingCopyEntryDto[] {
  if (unmerged.size === 0) {
    return [...entries];
  }
  const listed = new Set(entries.filter((entry) => entry.status === 'conflict').map((entry) => entry.path));
  const rest = entries.filter((entry) => !unmerged.has(entry.path) || entry.status === 'conflict');
  const added = [...unmerged].filter((path) => !listed.has(path))
    .map((path): WorkingCopyEntryDto => ({ path, group: 'unstaged', status: 'conflict' }));
  return [...rest, ...added].sort(compareWorkingCopyEntries);
}

export function compareWorkingCopyEntries(a: WorkingCopyEntryDto, b: WorkingCopyEntryDto): number {
  if (a.group !== b.group) {
    return groupOrder(a.group) - groupOrder(b.group);
  }
  return a.path.localeCompare(b.path);
}

const UNMERGED_PORCELAIN = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/** Parses `git status --porcelain=v1 -z` into staged, unstaged, and untracked rows. */
export function parsePorcelainChanges(output: string): WorkingCopyEntryDto[] {
  const entries: WorkingCopyEntryDto[] = [];
  let index = 0;
  while (index < output.length) {
    if (output[index] === '\0') {
      index += 1;
      continue;
    }
    if (index + 3 > output.length || output[index + 2] !== ' ') {
      break;
    }
    const indexStatus = output[index] ?? ' ';
    const workTreeStatus = output[index + 1] ?? ' ';
    const pathStart = index + 3;
    const pathEnd = output.indexOf('\0', pathStart);
    if (pathEnd < 0) {
      break;
    }
    const filePath = output.slice(pathStart, pathEnd).replace(/\\/g, '/');
    index = pathEnd + 1;
    let originalPath: string | undefined;
    if (
      indexStatus === 'R' ||
      indexStatus === 'C' ||
      workTreeStatus === 'R' ||
      workTreeStatus === 'C'
    ) {
      const originalEnd = output.indexOf('\0', index);
      if (originalEnd < 0) {
        break;
      }
      originalPath = output.slice(index, originalEnd).replace(/\\/g, '/');
      index = originalEnd + 1;
    }
    if (!filePath || indexStatus === '!' || workTreeStatus === '!') {
      continue;
    }
    const pair = `${indexStatus}${workTreeStatus}`;
    if (UNMERGED_PORCELAIN.has(pair)) {
      entries.push({ path: filePath, group: 'unstaged', status: 'conflict' });
      continue;
    }
    if (indexStatus === '?' && workTreeStatus === '?') {
      entries.push({ path: filePath, group: 'untracked', status: 'untracked' });
      continue;
    }
    if (indexStatus !== ' ' && indexStatus !== '?') {
      entries.push(porcelainEntry(filePath, 'staged', indexStatus, originalPath));
    }
    if (workTreeStatus !== ' ' && workTreeStatus !== '?') {
      entries.push(porcelainEntry(filePath, 'unstaged', workTreeStatus, originalPath));
    }
  }
  return entries.sort(compareWorkingCopyEntries);
}

export function projectWorkingCopyAction(
  entries: readonly WorkingCopyEntryDto[],
  action: { op: 'stage' | 'unstage' | 'discard'; path: string },
): WorkingCopyEntryDto[] {
  if (!entries.some((entry) => entry.path === action.path)) {
    return [...entries];
  }
  if (action.op === 'discard') {
    return entries.filter((entry) => entry.path !== action.path);
  }
  if (action.op === 'stage') {
    return projectStage(entries, action.path);
  }
  return projectUnstage(entries, action.path);
}

function porcelainEntry(
  filePath: string,
  group: WorkingCopyGroup,
  letter: string,
  originalPath: string | undefined,
): WorkingCopyEntryDto {
  const entry: WorkingCopyEntryDto = {
    path: filePath,
    group,
    status: porcelainStatus(letter),
  };
  if ((letter === 'R' || letter === 'C') && originalPath) {
    entry.originalPath = originalPath;
  }
  return entry;
}

function porcelainStatus(letter: string): WorkingCopyStatusLabel {
  switch (letter) {
    case 'M':
      return 'modified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'type-changed';
    case 'U':
      return 'conflict';
    default:
      return 'unknown';
  }
}

function stagedStatus(entry: WorkingCopyEntryDto): WorkingCopyStatusLabel {
  if (
    entry.group === 'untracked' ||
    entry.status === 'untracked' ||
    entry.status === 'intent-to-add'
  ) {
    return 'added';
  }
  return entry.status === 'conflict' ? 'modified' : entry.status;
}

function withRenameFields(
  source: WorkingCopyEntryDto,
  entry: WorkingCopyEntryDto,
  keepOriginal = true,
): WorkingCopyEntryDto {
  if (keepOriginal && source.originalPath) {
    entry.originalPath = source.originalPath;
  }
  if (source.submodule) {
    entry.submodule = true;
  }
  return entry;
}

function projectStage(entries: readonly WorkingCopyEntryDto[], filePath: string): WorkingCopyEntryDto[] {
  const incoming = entries.find((entry) => entry.path === filePath && entry.group !== 'staged');
  if (!incoming) {
    return [...entries];
  }
  const next = entries.filter((entry) => entry.path !== filePath);
  next.push(
    withRenameFields(incoming, {
      path: filePath,
      group: 'staged',
      status: stagedStatus(incoming),
    }),
  );
  return next.sort(compareWorkingCopyEntries);
}

function projectUnstage(entries: readonly WorkingCopyEntryDto[], filePath: string): WorkingCopyEntryDto[] {
  const staged = entries.find((entry) => entry.path === filePath && entry.group === 'staged');
  if (!staged) {
    return [...entries];
  }
  const rest = entries.filter((entry) => !(entry.path === filePath && entry.group === 'staged'));
  if (rest.some((entry) => entry.path === filePath)) {
    return rest;
  }
  const untracked = staged.status === 'added';
  const restored = withRenameFields(
    staged,
    {
      path: filePath,
      group: untracked ? 'untracked' : 'unstaged',
      status: untracked ? 'untracked' : staged.status,
    },
    !untracked,
  );
  return [...rest, restored].sort(compareWorkingCopyEntries);
}

function groupOrder(group: WorkingCopyGroup): number {
  switch (group) {
    case 'staged':
      return 0;
    case 'unstaged':
      return 1;
    case 'untracked':
      return 2;
  }
}

function entryFromChange(
  repoRoot: string,
  change: GitChange,
  group: WorkingCopyGroup,
): WorkingCopyEntryDto {
  const filePath = toRepoRelativePath(repoRoot, change.uri.fsPath);
  const original = toRepoRelativePath(repoRoot, change.originalUri.fsPath);
  const entry: WorkingCopyEntryDto = {
    path: filePath,
    group,
    status: workingCopyStatusLabel(change.status),
  };
  if (original && original !== filePath && !original.startsWith('..')) {
    entry.originalPath = original;
  }
  return entry;
}

/**
 * Parses `git ls-files -v -z`. Lowercase tags are assume-unchanged.
 * `S` / `s` is skip-worktree.
 */
export function parseLsFilesFlags(output: string): WorkingCopyFlagDto[] {
  const flags: WorkingCopyFlagDto[] = [];
  for (const record of output.split('\0')) {
    if (record.length < 3 || record[1] !== ' ') {
      continue;
    }
    const tag = record[0] ?? '';
    const filePath = record.slice(2).replace(/\\/g, '/');
    if (!filePath) {
      continue;
    }
    const assumeUnchanged = tag !== tag.toUpperCase();
    const skipWorktree = tag.toUpperCase() === 'S';
    if (!assumeUnchanged && !skipWorktree) {
      continue;
    }
    flags.push({ path: filePath, assumeUnchanged, skipWorktree });
  }
  return flags;
}

export function isStagedPath(
  repoRoot: string,
  state: Pick<RepositoryState, 'indexChanges'>,
  repoRelativePath: string,
): boolean {
  return (state.indexChanges ?? []).some(
    (change) => toRepoRelativePath(repoRoot, change.uri.fsPath) === repoRelativePath,
  );
}
