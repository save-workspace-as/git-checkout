import type { RepositoryState } from '../core/vscodeGitApi';

/** The repository selected in the sidebar, or nothing: `scm.countBadge` set to `off` hides the badge. */
export type CountBadgeMode = 'focused' | 'off';

type ChangeLists = Pick<RepositoryState, 'mergeChanges' | 'indexChanges' | 'workingTreeChanges' | 'untrackedChanges'>;

/** Changes in one repository, counted the way VS Code's Source Control icon counts them. */
export function repositoryChangeCount(state: ChangeLists): number {
  return (state.mergeChanges?.length ?? 0)
    + (state.indexChanges?.length ?? 0)
    + (state.workingTreeChanges?.length ?? 0)
    + (state.untrackedChanges?.length ?? 0);
}

/**
 * The number on the Git Checkout icon in the Activity Bar: the changes of the repository selected in the sidebar,
 * the one every view shows; 0 shows no badge.
 */
export function changeCountBadge(
  repositories: readonly { root: string; state: ChangeLists }[],
  mode: CountBadgeMode,
  activeRoot: string | null,
): number {
  if (mode === 'off') {
    return 0;
  }
  const counted = repositories.filter((repo) => repo.root === activeRoot);
  return counted.reduce((total, repo) => total + repositoryChangeCount(repo.state), 0);
}

export function parseCountBadgeMode(value: unknown): CountBadgeMode {
  return value === 'off' ? 'off' : 'focused';
}
