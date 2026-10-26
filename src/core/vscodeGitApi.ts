import type { Event, Uri } from 'vscode';

export interface GitExtension {
  readonly enabled: boolean;
  readonly onDidChangeEnablement: Event<void>;
  getAPI(version: 1): API;
}

export interface API {
  readonly git: Git;
  readonly repositories: Repository[];
  readonly onDidOpenRepository: Event<Repository>;
  readonly onDidCloseRepository: Event<Repository>;
}

export interface Git {
  readonly path: string;
}

export interface Branch {
  readonly name?: string;
  readonly ahead?: number;
  readonly behind?: number;
  readonly upstream?: Branch;
}

export interface FetchOptions {
  remote?: string;
  ref?: string;
  depth?: number;
  prune?: boolean;
}

export type ForcePushMode = boolean | number;

/** Numeric order matches vscode.git `Status`. Do not reorder. */
export enum GitChangeStatus {
  INDEX_MODIFIED,
  INDEX_ADDED,
  INDEX_DELETED,
  INDEX_RENAMED,
  INDEX_COPIED,
  MODIFIED,
  DELETED,
  UNTRACKED,
  IGNORED,
  INTENT_TO_ADD,
  INTENT_TO_RENAME,
  TYPE_CHANGED,
  ADDED_BY_US,
  ADDED_BY_THEM,
  DELETED_BY_US,
  DELETED_BY_THEM,
  BOTH_ADDED,
  BOTH_DELETED,
  BOTH_MODIFIED,
}

export interface GitChange {
  readonly uri: Uri;
  readonly originalUri: Uri;
  readonly renameUri?: Uri;
  readonly status: GitChangeStatus;
}

export interface Repository {
  readonly rootUri: Uri;
  readonly state: RepositoryState;
  fetch(options?: FetchOptions): Promise<void>;
  fetch(remote?: string, ref?: string, depth?: number): Promise<void>;
  pull(unshallow?: boolean): Promise<void>;
  push(
    remoteName?: string,
    branchName?: string,
    setUpstream?: boolean,
    force?: ForcePushMode,
  ): Promise<void>;
  checkout(treeish: string): Promise<void>;
  commit(message: string): Promise<void>;
  /** Paths are absolute (`Uri.file` in the vscode.git 1.90 API). */
  add(paths: string[]): Promise<void>;
  revert(paths: string[]): Promise<void>;
  clean(paths: string[]): Promise<void>;
  merge?(ref: string): Promise<void>;
  rebase?(ref: string): Promise<void>;
}

export interface RepositoryState {
  readonly HEAD?: Branch;
  readonly onDidChange: Event<void>;
  /** Files with merge conflicts: vscode.git lists them here, not in the working tree or index changes. */
  readonly mergeChanges?: readonly GitChange[];
  readonly indexChanges?: readonly GitChange[];
  readonly workingTreeChanges?: readonly GitChange[];
  readonly untrackedChanges?: readonly GitChange[];
}
