import { sameWorktreePath } from './worktreeParser';

export type WorktreeOpenPlan = { action: 'reveal' } | { action: 'prompt'; path: string };

/** Same folder stays in this window. Any other folder is confirmed, then opened in a new window. */
export function planWorktreeOpen(
  worktreePath: string,
  workspacePaths: readonly string[],
): WorktreeOpenPlan {
  if (workspacePaths.some((folder) => sameWorktreePath(folder, worktreePath))) {
    return { action: 'reveal' };
  }
  return { action: 'prompt', path: worktreePath };
}
