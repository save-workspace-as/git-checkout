export type RefreshReason = 'filesystem' | 'vscodeGitState' | 'manual' | 'layout';

/** Coalesces refresh reasons while a debounced refresh is pending. */
export function coalescePendingRefreshReason(
  pending: RefreshReason,
  incoming: RefreshReason,
): RefreshReason {
  if (incoming === 'filesystem') {
    return 'filesystem';
  }
  if (pending === 'filesystem') {
    return 'filesystem';
  }
  return incoming;
}

export interface RepositoryRefreshEvent {
  repoRoot: string;
  reason: RefreshReason;
  headShort: string | null;
  at: number;
}
