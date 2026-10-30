export type RepoOperationKind = 'merge' | 'rebase' | 'cherry-pick' | 'revert' | 'bisect' | null;

export interface RepoOperationDto {
  active: boolean;
  kind: RepoOperationKind;
  conflicted: boolean;
  summary: string;
  /** How many paths are unmerged. */
  conflictCount?: number;
  /** For a rebase: the commit it is applying (`step`) out of all of them (`total`). */
  progress?: { step: number; total: number };
  /** The branch being rebased. */
  branch?: string;
  /** What the operation brings in: the rebase's new base, or the commit being merged, picked or reverted (short hash). */
  target?: string;
  /** The commit whose changes conflict (short hash). */
  commit?: string;
}

export const IDLE_REPO_OPERATION: RepoOperationDto = {
  active: false,
  kind: null,
  conflicted: false,
  summary: '',
};

export type HistoryWebviewMessage =
  | { type: 'historyMerge'; ref: string }
  | { type: 'historyRebaseOnto'; ref: string }
  | { type: 'historyReset'; sha: string }
  | { type: 'historyEditMessage'; sha: string }
  | { type: 'historyCherryPick'; sha: string }
  | { type: 'historyRevert'; sha: string }
  | { type: 'historyArchive'; ref: string }
  | { type: 'historyRange'; op: 'squash' | 'drop' | 'cherryPick'; shas: string[] }
  | { type: 'historyCheckout'; sha: string }
  /** Checkout the branch whose badge was right-clicked, not just the commit it points at. */
  | { type: 'historyCheckoutRef'; ref: string; local: boolean }
  | { type: 'historyDeleteBranch'; name: string; remote: boolean }
  /** An action on the branch whose badge was right-clicked. */
  | { type: 'historyBranchAction'; action: 'fastForward' | 'pull' | 'push' | 'rename' | 'copyName' | 'pullRequest'; ref: string }
  | { type: 'historyNewBranch'; sha: string; /** A name for the commit to start from; the hash when it has none. */ startRef?: string }
  | { type: 'historyNewTag'; sha: string }
  | { type: 'historyInteractiveRebase'; onto: string }
  /** The banner's buttons while a merge, rebase, cherry-pick or revert is unfinished. */
  | { type: 'operationResolve' }
  | { type: 'operationContinue' }
  | { type: 'operationAbort' };
