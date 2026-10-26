import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GitCli } from '../gitCli';
import { GitOperationQueue } from '../gitOperationQueue';

export const GIT_TEST_IDENTITY_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'git-checkout-test',
  GIT_AUTHOR_EMAIL: 'test@git-checkout.local',
  GIT_COMMITTER_NAME: 'git-checkout-test',
  GIT_COMMITTER_EMAIL: 'test@git-checkout.local',
};

export function runGit(repoRoot: string, args: string[], env: NodeJS.ProcessEnv = GIT_TEST_IDENTITY_ENV): void {
  execSync(['git', ...args].join(' '), {
    cwd: repoRoot,
    env,
    stdio: 'ignore',
  });
}

/** Empty commit with fixed author and committer timestamps (unix seconds). */
export function commitEmptyAt(repoRoot: string, message: string, unixSeconds: number): void {
  const date = `@${unixSeconds}`;
  runGit(
    repoRoot,
    ['commit', '--allow-empty', '-m', message, `--date=${date}`],
    {
      ...GIT_TEST_IDENTITY_ENV,
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    },
  );
}

/** Runs git and returns the exit code (does not throw on failure). */
export function runGitAllowFailure(repoRoot: string, args: string[]): number {
  try {
    execSync(['git', ...args].join(' '), {
      cwd: repoRoot,
      env: GIT_TEST_IDENTITY_ENV,
      stdio: 'ignore',
    });
    return 0;
  } catch (error) {
    const status = (error as NodeJS.ErrnoException & { status?: number }).status;
    return typeof status === 'number' ? status : 1;
  }
}

/**
 * Creates `main` and `other` with a conflicting change to `conflict.txt`.
 * Leaves HEAD on `main`, ready to `git merge other`.
 */
export function seedDivergentFileConflict(repo: TempGitRepository): void {
  const file = join(repo.repoRoot, 'conflict.txt');
  writeFileSync(file, 'base\n');
  runGit(repo.repoRoot, ['add', 'conflict.txt']);
  runGit(repo.repoRoot, ['commit', '-m', 'base']);

  runGit(repo.repoRoot, ['branch', 'other']);
  writeFileSync(file, 'base\non main\n');
  runGit(repo.repoRoot, ['add', 'conflict.txt']);
  runGit(repo.repoRoot, ['commit', '-m', 'main']);

  runGit(repo.repoRoot, ['checkout', 'other']);
  writeFileSync(file, 'base\non other\n');
  runGit(repo.repoRoot, ['add', 'conflict.txt']);
  runGit(repo.repoRoot, ['commit', '-m', 'other']);

  runGit(repo.repoRoot, ['checkout', 'main']);
}

export function createTestGitCli(repoRoot: string): GitCli {
  return new GitCli('git', repoRoot, new GitOperationQueue());
}

export interface TempGitRepository {
  repoRoot: string;
  cli: GitCli;
  cleanup: () => void;
}

export function initTempRepository(): TempGitRepository {
  const repoRoot = mkdtempSync(join(tmpdir(), 'git-checkout-int-'));
  runGit(repoRoot, ['init', '-b', 'main']);
  runGit(repoRoot, ['config', 'user.email', 'test@git-checkout.local']);
  runGit(repoRoot, ['config', 'user.name', 'git-checkout-test']);
  return {
    repoRoot,
    cli: createTestGitCli(repoRoot),
    cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
  };
}
