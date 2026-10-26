import { isCommitTreePathContext } from './pathHistoryProtocol';

/** A file row's context-menu target: a file at a commit, or a change between two commits. */
export interface CommitFileTarget {
  path: string;
  revision: string;
  baseRevision?: string;
  oldPath?: string;
  status?: string;
  list: 'changes' | 'tree';
}

/** The file a context-menu command was run on, or null for anything else (a folder, no revision). */
export function commitFileTarget(arg: unknown): CommitFileTarget | null {
  if (!isCommitTreePathContext(arg) || arg.commitTreeKind !== 'blob' || !arg.revision?.trim()) {
    return null;
  }
  return {
    path: arg.path,
    revision: arg.revision.trim(),
    ...(arg.baseRevision ? { baseRevision: arg.baseRevision } : {}),
    ...(arg.oldPath ? { oldPath: arg.oldPath } : {}),
    ...(arg.status ? { status: arg.status } : {}),
    list: arg.list === 'changes' ? 'changes' : 'tree',
  };
}

export interface FileRevision {
  revision: string;
  path: string;
}

/**
 * Where "Reset File to" takes content from: the commit itself, or what came just before it (the older
 * commit of a comparison, else the first parent), under the file's old name if it was renamed.
 */
export function resetSources(target: CommitFileTarget): { atCommit: FileRevision; beforeCommit: FileRevision } {
  return {
    atCommit: { revision: target.revision, path: target.path },
    beforeCommit: {
      revision: target.baseRevision ?? `${target.revision}^`,
      path: target.oldPath ?? target.path,
    },
  };
}

/**
 * The version of the file to show for "Open": the commit's own, or for a deleted file the last
 * version before the deletion, since the commit no longer has it.
 */
export function openRevision(target: CommitFileTarget): FileRevision {
  if (target.status?.startsWith('D')) {
    return resetSources(target).beforeCommit;
  }
  return { revision: target.revision, path: target.path };
}
