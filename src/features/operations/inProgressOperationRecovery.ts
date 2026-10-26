import type { RepoOperationDto } from '../../shared/history/historyProtocol';

export interface InProgressRecoveryPlan {
  /** Keep the bisect toolbar and graph marks; the session lives in `.git/BISECT_*`. */
  restoreBisect: boolean;
}

/**
 * Chooses which in-progress UI to restore after activation or webview reload. A stopped merge, rebase,
 * cherry-pick or revert is shown by the banner above the graph, which needs no restoring.
 */
export function planInProgressRecovery(operation: RepoOperationDto): InProgressRecoveryPlan {
  return { restoreBisect: (operation.active || operation.conflicted) && operation.kind === 'bisect' };
}
