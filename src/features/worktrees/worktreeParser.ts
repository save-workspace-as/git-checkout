import { realpathSync } from 'node:fs';
import * as path from 'path';

import type { GitWorktreeDto } from '../../shared/worktrees/worktreeProtocol';

function stripTrailingSep(value: string): string {
  return value.replace(/[\\/]+$/, '');
}

function canonicalPath(input: string): string {
  const resolved = stripTrailingSep(path.resolve(input));
  try {
    return stripTrailingSep(realpathSync(resolved));
  } catch {
    return resolved;
  }
}

export function sameWorktreePath(left: string, right: string): boolean {
  const a = canonicalPath(left);
  const b = canonicalPath(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function parseWorktreeList(stdout: string, currentRoot: string): GitWorktreeDto[] {
  const entries: GitWorktreeDto[] = [];
  let pending: {
    path?: string;
    head?: string;
    branch?: string;
    detached?: boolean;
    bare?: boolean;
    locked?: boolean;
    prunable?: boolean;
  } | null = null;

  const flush = (): void => {
    if (!pending?.path) {
      pending = null;
      return;
    }
    entries.push({
      path: pending.path,
      head: pending.head ?? null,
      branch: pending.branch ?? null,
      detached: pending.detached ?? false,
      bare: pending.bare ?? false,
      locked: pending.locked ?? false,
      prunable: pending.prunable ?? false,
      current: sameWorktreePath(pending.path, currentRoot),
    });
    pending = null;
  };

  for (const line of stdout.split('\n')) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) {
      flush();
      pending = { path: line.slice('worktree '.length) };
      continue;
    }
    if (!pending) {
      continue;
    }
    if (line.startsWith('HEAD ')) {
      pending.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      pending.branch = line.slice('branch '.length);
    } else if (line === 'detached') {
      pending.detached = true;
    } else if (line === 'bare') {
      pending.bare = true;
    } else if (line === 'locked' || line.startsWith('locked ')) {
      pending.locked = true;
    } else if (line === 'prunable' || line.startsWith('prunable ')) {
      pending.prunable = true;
    }
  }
  flush();
  return entries;
}
