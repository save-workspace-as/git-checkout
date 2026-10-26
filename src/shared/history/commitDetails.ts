import type { CommitFileChangeDto } from './commitDetailsProtocol';

/** `git hash-object -t tree` of an empty directory. Used as the base of a root commit. */
export const EMPTY_TREE_REVISION = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export interface CommitDiffEndpoints {
  leftRevision: string;
  leftPath: string;
  rightRevision: string;
  rightPath: string;
}

const RENAME_OR_COPY = /^[RC]\d*$/;

/** Parses `git diff-tree -z --name-status` records, including rename and copy pairs. */
export function parseCommitNameStatus(output: string): CommitFileChangeDto[] {
  if (!output) {
    return [];
  }
  const fields = output.split('\0');
  if (fields[fields.length - 1] === '') {
    fields.pop();
  }
  const changes: CommitFileChangeDto[] = [];
  let index = 0;
  while (index < fields.length) {
    const status = fields[index];
    index += 1;
    if (!status) {
      continue;
    }
    if (RENAME_OR_COPY.test(status)) {
      const oldPath = (fields[index] ?? '').replace(/\\/g, '/');
      const path = (fields[index + 1] ?? '').replace(/\\/g, '/');
      index += 2;
      if (path) {
        changes.push({ status, path, oldPath });
      }
      continue;
    }
    const path = (fields[index] ?? '').replace(/\\/g, '/');
    index += 1;
    if (path) {
      changes.push({ status, path });
    }
  }
  return changes;
}

/** Left is the first parent (or the empty tree); right is the selected commit. */
export function commitFileDiffEndpoints(
  sha: string,
  parent: string | null,
  change: CommitFileChangeDto,
): CommitDiffEndpoints {
  const letter = change.status.charAt(0);
  const leftPath = letter === 'R' || letter === 'C' ? (change.oldPath ?? change.path) : change.path;
  return {
    leftRevision: parent ?? EMPTY_TREE_REVISION,
    leftPath,
    rightRevision: sha,
    rightPath: change.path,
  };
}

export function commitDetailsDiffArgs(revision: string): string[] {
  return [
    'diff-tree',
    '--no-commit-id',
    '--root',
    '-r',
    '-m',
    '--first-parent',
    '-z',
    '--name-status',
    '--find-renames',
    revision,
  ];
}

/** Files that differ between two commits, in `git diff-tree` name-status form. */
export function commitCompareDiffArgs(base: string, revision: string): string[] {
  return ['diff', '-z', '--name-status', '--find-renames', base, revision];
}
