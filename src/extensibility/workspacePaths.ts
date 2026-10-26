import * as path from 'path';

import { sameWorktreePath } from '../features/worktrees/worktreeParser';

export function toRepoRelativePosix(repoRoot: string, target: string): string | null {
  const relative = path.relative(path.resolve(repoRoot), path.resolve(target));
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return relative.split(path.sep).join('/');
}

export function repoRootContaining(roots: readonly string[], target?: string): string | null {
  if (!target) {
    return roots[0] ?? null;
  }
  const matches = roots.filter(
    (root) => sameWorktreePath(root, target) || toRepoRelativePosix(root, target) !== null,
  );
  matches.sort((left, right) => path.resolve(right).length - path.resolve(left).length);
  return matches[0] ?? null;
}

export function fsPathsFromCommandArgs(arg: unknown, selected?: unknown): string[] {
  const values: unknown[] = [arg];
  if (Array.isArray(selected)) {
    values.push(...selected);
  }
  const paths: string[] = [];
  for (const value of values) {
    if (!value || typeof value !== 'object' || !('fsPath' in value)) {
      continue;
    }
    const fsPath = (value as { fsPath?: unknown }).fsPath;
    if (typeof fsPath !== 'string' || paths.includes(fsPath)) {
      continue;
    }
    paths.push(fsPath);
  }
  return paths;
}
