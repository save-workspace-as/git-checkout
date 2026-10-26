/** Branches that are never offered for deletion, whatever Git says about them. */
const PROTECTED_BRANCHES = ['main', 'master', 'develop', 'dev', 'trunk'];

/**
 * Reads `git branch --merged`: one name per line, a star before the checked-out branch and a plus before
 * one checked out in another worktree. Those, and the long-lived branches, are left out.
 */
export function parseMergedBranches(output: string, protectedNames: readonly string[] = PROTECTED_BRANCHES): string[] {
  const names: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    if (!line.trim() || /^[*+]/.test(line)) { continue; }
    const name = line.trim();
    if (name.startsWith('(') || protectedNames.includes(name)) { continue; }
    names.push(name);
  }
  return names;
}

/** Reads `git remote prune --dry-run`: the remote-tracking branches whose branch is gone from the remote. */
export function parsePrunable(output: string): string[] {
  return output.split(/\r?\n/)
    .map((line) => /^\s*\*\s*\[would prune\]\s+(\S+)/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}

/** Reads `git clean -n`: the files and folders it would delete, folders with a trailing slash. */
export function parseCleanPreview(output: string): string[] {
  return output.split(/\r?\n/)
    .map((line) => /^Would remove (.+)$/.exec(line)?.[1])
    .filter((path): path is string => path !== undefined);
}
