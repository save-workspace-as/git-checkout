import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

/** Kept in the workspace so replacing the fixture stays multi-root and does not reload VS Code. */
export const SENTINEL_DIR_NAME = 'git-checkout-e2e-sentinel';

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

/** Empty `main` at `v1.0.0`, with `agent/feature` beside it. */
export function createFixtureRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-'));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'git-checkout-e2e');
  git(root, 'config', 'user.email', 'e2e@git-checkout.local');
  git(root, 'commit', '--allow-empty', '-m', 'init');
  git(root, 'branch', 'agent/feature');
  git(root, 'tag', 'v1.0.0');
  return root;
}

export function isSentinelFolder(fsPath: string): boolean {
  return basename(fsPath) === SENTINEL_DIR_NAME;
}

/** Multi-root workspace: one fixture repo plus the sentinel folder. */
export function createLaunchWorkspace(): string {
  const parent = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-ws-'));
  const sentinel = join(parent, SENTINEL_DIR_NAME);
  mkdirSync(sentinel);
  const workspaceFile = join(parent, 'e2e.code-workspace');
  writeFileSync(
    workspaceFile,
    JSON.stringify({
      folders: [{ path: createFixtureRepo() }, { path: sentinel }],
    }),
  );
  return workspaceFile;
}
