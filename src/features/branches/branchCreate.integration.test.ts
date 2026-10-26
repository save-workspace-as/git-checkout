import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { executeBranchCreate } from './branchCreate';
import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';

function gitOutput(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}

describe('executeBranchCreate integration', () => {
  it('creates a branch and leaves HEAD in place', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
      runGit(repo.repoRoot, ['checkout', '-b', 'user/feat/foo']);
      await executeBranchCreate(repo.cli, {
        name: 'user/feat/bar',
        checkout: false,
        localChanges: 'keep',
      });
      assert.equal(gitOutput(repo.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'user/feat/foo');
      assert.equal(
        gitOutput(repo.repoRoot, ['rev-parse', 'user/feat/bar']),
        gitOutput(repo.repoRoot, ['rev-parse', 'HEAD']),
      );
    } finally {
      repo.cleanup();
    }
  });

  it('checks out the new branch and keeps a local edit', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
      const notes = join(repo.repoRoot, 'notes.txt');
      writeFileSync(notes, 'local\n');
      await executeBranchCreate(repo.cli, {
        name: 'topic',
        checkout: true,
        localChanges: 'keep',
      });
      assert.equal(gitOutput(repo.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'topic');
      assert.equal(readFileSync(notes, 'utf8'), 'local\n');
    } finally {
      repo.cleanup();
    }
  });

  it('stashes a local edit, checks out, and reapplies it', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
      const notes = join(repo.repoRoot, 'notes.txt');
      writeFileSync(notes, 'local\n');
      await executeBranchCreate(repo.cli, {
        name: 'topic',
        checkout: true,
        localChanges: 'stash',
      });
      assert.equal(gitOutput(repo.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'topic');
      assert.equal(readFileSync(notes, 'utf8'), 'local\n');
      assert.equal(gitOutput(repo.repoRoot, ['stash', 'list']), '');
    } finally {
      repo.cleanup();
    }
  });

  it('discards uncommitted changes before checking out the new branch', async () => {
    const repo = initTempRepository();
    try {
      const tracked = join(repo.repoRoot, 'tracked.txt');
      writeFileSync(tracked, 'base\n');
      runGit(repo.repoRoot, ['add', 'tracked.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'track']);
      writeFileSync(tracked, 'edited\n');
      writeFileSync(join(repo.repoRoot, 'extra.txt'), 'new\n');
      await executeBranchCreate(repo.cli, {
        name: 'topic',
        checkout: true,
        localChanges: 'discard',
      });
      assert.equal(gitOutput(repo.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']), 'topic');
      assert.equal(readFileSync(tracked, 'utf8'), 'base\n');
      assert.equal(existsSync(join(repo.repoRoot, 'extra.txt')), false);
      assert.equal(gitOutput(repo.repoRoot, ['status', '--porcelain']), '');
    } finally {
      repo.cleanup();
    }
  });
});
