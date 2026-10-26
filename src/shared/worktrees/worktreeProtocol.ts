export interface GitWorktreeDto {
  path: string;
  head: string | null;
  /** Full branch ref, for example `refs/heads/main`. Null when detached or bare. */
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  /** True when this worktree is the workspace folder Git Checkout is bound to. */
  current: boolean;
}

export interface WorktreeCreateRequest {
  path: string;
  /** When set, `git worktree add -b` creates this branch. */
  newBranch?: string;
  /** Existing branch, or the start point for `newBranch`. */
  startPoint?: string;
}

export function worktreeBranchLabel(
  entry: Pick<GitWorktreeDto, 'branch' | 'bare' | 'detached' | 'head'>,
): string {
  if (entry.branch?.startsWith('refs/heads/')) {
    return entry.branch.slice('refs/heads/'.length);
  }
  if (entry.bare) {
    return '(bare)';
  }
  if (entry.detached) {
    const sha = entry.head?.slice(0, 7);
    return sha ? `(detached ${sha})` : '(detached)';
  }
  return '(unknown)';
}
