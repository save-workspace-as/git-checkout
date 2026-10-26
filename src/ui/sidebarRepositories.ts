import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createLogger } from '../log';
import { sameWorktreePath } from '../features/worktrees/worktreeParser';

const log = createLogger('repositories');

export type RepositoryKind = 'repository' | 'worktree' | 'submodule';

/**
 * vscode.git also opens a repository's linked worktrees and submodules. They have a `.git` file
 * (not a folder) that points into `.git/worktrees/` or `.git/modules/` of the owning repository.
 */
export function repositoryKind(root: string): RepositoryKind {
  const marker = join(root, '.git');
  try {
    if (!statSync(marker).isFile()) {
      return 'repository';
    }
    const target = readFileSync(marker, 'utf8').replaceAll('\\', '/');
    if (/\/worktrees\/[^/]+\s*$/.test(target)) {
      return 'worktree';
    }
    if (/\/modules\//.test(target)) {
      return 'submodule';
    }
  } catch (error) {
    // A repository without a readable .git entry (for example a remote path) stays listed.
    log.debug(`could not classify ${root}`, error);
  }
  return 'repository';
}

function canonical(root: string): string {
  try {
    return realpathSync.native(root);
  } catch (error) {
    // The folder may be gone or remote; compare the path as given.
    log.debug(`could not resolve ${root}`, error);
    return root;
  }
}

/**
 * Repositories to show in the sidebar, in workspace-folder order.
 *
 * - The same folder reported twice (for example with different letter case) is listed once.
 * - A workspace folder is always listed, even when it is a worktree or submodule.
 * - Other repositories are skipped when they are a linked worktree or submodule, since the
 *   sidebar already lists those under Worktrees and Submodules.
 */
export function sidebarRepositoryRoots(
  roots: readonly string[],
  workspaceFolders: readonly string[],
  kindOf: (root: string) => RepositoryKind = repositoryKind,
  canonicalOf: (root: string) => string = canonical,
): string[] {
  const folders = workspaceFolders.map(canonicalOf);
  const kept: { root: string; key: string; order: number }[] = [];
  roots.forEach((root, index) => {
    const key = canonicalOf(root);
    const duplicate = kept.find((entry) => sameWorktreePath(entry.key, key));
    if (duplicate) {
      // Same folder under another spelling: prefer the one the workspace folder uses.
      if (workspaceFolders.includes(root) && !workspaceFolders.includes(duplicate.root)) {
        duplicate.root = root;
      }
      return;
    }
    const folder = folders.findIndex((entry) => sameWorktreePath(entry, key));
    if (folder < 0 && kindOf(root) !== 'repository') {
      return;
    }
    kept.push({ root, key, order: folder >= 0 ? folder : folders.length + index });
  });
  return kept.sort((a, b) => a.order - b.order).map((entry) => entry.root);
}
