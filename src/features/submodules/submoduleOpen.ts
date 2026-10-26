import * as path from 'path';

import { sameWorktreePath } from '../worktrees/worktreeParser';

export type SubmoduleOpenPlan = { action: 'inner'; path: string } | { action: 'openFolder'; path: string };

/**
 * A submodule inside an open workspace folder stays in this window.
 * Anything else is opened with Open Folder.
 */
export function planSubmoduleOpen(
  submodulePath: string,
  workspacePaths: readonly string[],
): SubmoduleOpenPlan {
  if (workspacePaths.some((folder) => isInsideWorkspace(folder, submodulePath))) {
    return { action: 'inner', path: submodulePath };
  }
  return { action: 'openFolder', path: submodulePath };
}

export function resolveActiveRepoRoot(
  roots: readonly string[],
  preferred: string | null,
): string | null {
  if (preferred) {
    const match = roots.find((root) => sameWorktreePath(root, preferred));
    if (match) {
      return match;
    }
  }
  return roots[0] ?? null;
}

function isInsideWorkspace(folder: string, target: string): boolean {
  if (sameWorktreePath(folder, target)) {
    return true;
  }
  const relative = path.relative(path.resolve(folder), path.resolve(target));
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
