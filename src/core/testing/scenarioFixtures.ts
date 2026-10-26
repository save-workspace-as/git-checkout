import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createTestGitCli,
  GIT_TEST_IDENTITY_ENV,
  initTempRepository,
  runGit,
  runGitAllowFailure,
  seedDivergentFileConflict,
  type TempGitRepository,
} from './gitRepoHarness';

export interface ScenarioFixture {
  repo: TempGitRepository;
  extras: string[];
  cleanup: () => void;
}

const LFS_OID = '4d7a214614ab2935c943f9a15698f1323bddb093b995844a6503eaf3bbb788f2';

export function lfsPointerText(): string {
  return `version https://git-lfs.github.com/spec/v1\noid sha256:${LFS_OID}\nsize 10\n`;
}

function fixture(repo: TempGitRepository, extras: string[] = []): ScenarioFixture {
  return {
    repo,
    extras,
    cleanup: () => {
      for (const extra of [...extras].reverse()) {
        rmSync(extra, { recursive: true, force: true });
      }
      repo.cleanup();
    },
  };
}

function withRepo(build: (repo: TempGitRepository) => ScenarioFixture): ScenarioFixture {
  const repo = initTempRepository();
  try {
    return build(repo);
  } catch (error) {
    repo.cleanup();
    throw error;
  }
}

function commitFile(repoRoot: string, relativePath: string, contents: string, message: string): void {
  writeFileSync(join(repoRoot, relativePath), contents);
  runGit(repoRoot, ['add', relativePath]);
  runGit(repoRoot, ['commit', '-m', message]);
}

export function createContentMergeConflict(): ScenarioFixture {
  return withRepo((repo) => {
    seedDivergentFileConflict(repo);
    const code = runGitAllowFailure(repo.repoRoot, ['merge', '--no-edit', 'other']);
    if (code === 0) {
      throw new Error('expected a content merge conflict');
    }
    return fixture(repo);
  });
}

export function createModifyDeleteConflict(): ScenarioFixture {
  return withRepo((repo) => {
    commitFile(repo.repoRoot, 'note.txt', 'base\n', 'base');
    runGit(repo.repoRoot, ['branch', 'other']);
    commitFile(repo.repoRoot, 'note.txt', 'base\nmain edit\n', 'edit-note');
    runGit(repo.repoRoot, ['checkout', 'other']);
    runGit(repo.repoRoot, ['rm', 'note.txt']);
    runGit(repo.repoRoot, ['commit', '-m', 'delete']);
    runGit(repo.repoRoot, ['checkout', 'main']);
    const code = runGitAllowFailure(repo.repoRoot, ['merge', '--no-edit', 'other']);
    if (code === 0) {
      throw new Error('expected a modify/delete conflict');
    }
    return fixture(repo);
  });
}

export function createAddAddConflict(): ScenarioFixture {
  return withRepo((repo) => {
    runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'base']);
    runGit(repo.repoRoot, ['branch', 'other']);
    commitFile(repo.repoRoot, 'added.txt', 'from main\n', 'add-main');
    runGit(repo.repoRoot, ['checkout', 'other']);
    commitFile(repo.repoRoot, 'added.txt', 'from other\n', 'add-other');
    runGit(repo.repoRoot, ['checkout', 'main']);
    const code = runGitAllowFailure(repo.repoRoot, ['merge', '--no-edit', 'other']);
    if (code === 0) {
      throw new Error('expected an add/add conflict');
    }
    return fixture(repo);
  });
}

export function createRebaseConflict(): ScenarioFixture {
  return withRepo((repo) => {
    seedDivergentFileConflict(repo);
    runGit(repo.repoRoot, ['checkout', 'other']);
    const code = runGitAllowFailure(repo.repoRoot, ['rebase', 'main']);
    if (code === 0) {
      throw new Error('expected a rebase conflict');
    }
    return fixture(repo);
  });
}

export function createSubmoduleFixture(): ScenarioFixture {
  const childRoot = mkdtempSync(join(tmpdir(), 'git-checkout-sub-'));
  const repo = initTempRepository();
  try {
    runGit(childRoot, ['init', '-b', 'main']);
    runGit(childRoot, ['config', 'user.email', 'test@git-checkout.local']);
    runGit(childRoot, ['config', 'user.name', 'git-checkout-test']);
    commitFile(childRoot, 'lib.txt', 'lib\n', 'lib');
    runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
    execFileSync(
      'git',
      ['-c', 'protocol.file.allow=always', 'submodule', 'add', childRoot, 'vendor'],
      { cwd: repo.repoRoot, env: GIT_TEST_IDENTITY_ENV, stdio: 'pipe' },
    );
    return fixture(repo, [childRoot]);
  } catch (error) {
    rmSync(childRoot, { recursive: true, force: true });
    repo.cleanup();
    throw error;
  }
}

export function createWorktreeFixture(): ScenarioFixture {
  return withRepo((repo) => {
    runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
    const parent = mkdtempSync(join(tmpdir(), 'git-checkout-wt-'));
    const linked = join(parent, 'linked');
    try {
      runGit(repo.repoRoot, ['worktree', 'add', '-b', 'feature', linked]);
      return fixture(repo, [parent]);
    } catch (error) {
      rmSync(parent, { recursive: true, force: true });
      throw error;
    }
  });
}

/** Committed Git LFS pointer text, without requiring the git-lfs binary. */
export function createLfsPointerFixture(): ScenarioFixture {
  return withRepo((repo) => {
    commitFile(repo.repoRoot, 'hero.bin', lfsPointerText(), 'pointer');
    return fixture(repo);
  });
}

/**
 * `git init --ref-format=reftable` when this git supports it.
 * Returns null when the installed git has no reftable init flag.
 */
export function tryInitReftableRepository(): TempGitRepository | null {
  const repoRoot = mkdtempSync(join(tmpdir(), 'git-checkout-reftable-'));
  const code = runGitAllowFailure(repoRoot, ['init', '-b', 'main', '--ref-format=reftable']);
  if (code !== 0) {
    rmSync(repoRoot, { recursive: true, force: true });
    return null;
  }
  try {
    runGit(repoRoot, ['config', 'user.email', 'test@git-checkout.local']);
    runGit(repoRoot, ['config', 'user.name', 'git-checkout-test']);
    return {
      repoRoot,
      cli: createTestGitCli(repoRoot),
      cleanup: () => rmSync(repoRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    rmSync(repoRoot, { recursive: true, force: true });
    throw error;
  }
}

export function rebaseInProgress(repoRoot: string): boolean {
  return (
    existsSync(join(repoRoot, '.git', 'rebase-merge')) ||
    existsSync(join(repoRoot, '.git', 'rebase-apply'))
  );
}
