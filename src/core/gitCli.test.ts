import { strict as assert } from 'node:assert';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { formatGitCommand, GitCli, gitChildEnv, normalizeGitPath, type GitExecResult } from './gitCli';
import { GitOperationQueue } from './gitOperationQueue';

describe('formatGitCommand', () => {
  it('names the command without the commit message or a credential in a URL', () => {
    assert.equal(
      formatGitCommand(['commit', '-m', 'Fix the thing', '--amend']),
      'git commit -m <message> --amend',
    );
    assert.equal(formatGitCommand(['commit', '--message=Fix the thing']), 'git commit --message=<message>');
    assert.equal(
      formatGitCommand(['remote', 'add', 'origin', 'https://user:token@github.com/org/repo.git']),
      'git remote add origin https://github.com/org/repo.git',
    );
  });

  it('keeps a mainline parent number, which is not a message', () => {
    assert.equal(formatGitCommand(['cherry-pick', '-m', '1', 'abc']), 'git cherry-pick -m 1 abc');
  });
});

describe('normalizeGitPath', () => {
  const repoRoot = '/workspace/project';

  it('returns repo root for empty input', () => {
    assert.equal(normalizeGitPath(repoRoot, ''), repoRoot);
    assert.equal(normalizeGitPath(repoRoot, '   '), repoRoot);
  });

  it('resolves relative git-dir paths against the repository root', () => {
    assert.equal(normalizeGitPath(repoRoot, '.git'), `${repoRoot}/.git`);
  });

  it('normalizes absolute paths', () => {
    assert.equal(normalizeGitPath(repoRoot, '/var/git/project.git'), '/var/git/project.git');
  });
});

describe('gitChildEnv', () => {
  it('drops inherited discovery variables so cwd selects the worktree', () => {
    const env = gitChildEnv({
      PATH: '/usr/bin',
      GIT_DIR: '/repo/.git',
      GIT_WORK_TREE: '/repo',
      GIT_COMMON_DIR: '/repo/.git',
      GIT_AUTHOR_NAME: 'kept',
    });
    assert.equal(env.PATH, '/usr/bin');
    assert.equal(env.GIT_AUTHOR_NAME, 'kept');
    assert.equal(env.GIT_DIR, undefined);
    assert.equal(env.GIT_WORK_TREE, undefined);
    assert.equal(env.GIT_COMMON_DIR, undefined);
  });

  it('lets an explicit override pin the git dir after discovery vars are cleared', () => {
    const env = gitChildEnv({ GIT_DIR: '/repo/.git' }, { GIT_DIR: '/repo/.git/worktrees/feature' });
    assert.equal(env.GIT_DIR, '/repo/.git/worktrees/feature');
  });
});

describe('GitCli.resolveGitDirectories', () => {
  /** A CLI whose `git` is a script: records each call and answers from `answer`. */
  function cliWith(answer: (args: string[]) => string) {
    const calls: string[][] = [];
    class FakeCli extends GitCli {
      override async execRead(args: string[]): Promise<GitExecResult> {
        calls.push(args);
        return { stdout: answer(args), stderr: '', exitCode: 0 };
      }
    }
    return { calls, cli: new FakeCli('git', '/work/repo', new GitOperationQueue()) };
  }

  it('asks one git process for both directories', async () => {
    const { calls, cli } = cliWith(() => '/work/repo/.git\n/work/repo/.git\n');
    assert.deepEqual(await cli.resolveGitDirectories(), { gitDir: '/work/repo/.git', commonDir: '/work/repo/.git' });
    assert.deepEqual(calls, [['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']]);
  });

  it('tells a linked worktree from its main repository', async () => {
    const { cli } = cliWith(() => '/main/.git/worktrees/wt\n/main/.git\n');
    assert.deepEqual(await cli.resolveGitDirectories(), { gitDir: '/main/.git/worktrees/wt', commonDir: '/main/.git' });
  });

  it('remembers the answer instead of asking again on every refresh', async () => {
    const { calls, cli } = cliWith(() => '/work/repo/.git\n/work/repo/.git\n');
    await Promise.all([cli.resolveGitDirectories(), cli.resolveGitDirectories()]);
    await cli.resolveGitDirectories();
    assert.equal(calls.length, 1);
  });

  it('falls back to relative paths for an older git, and does not remember a failure', async () => {
    let failing = true;
    const { calls, cli } = cliWith((args) => {
      if (failing) {
        failing = false;
        throw new Error('unknown option --path-format');
      }
      return args.includes('--path-format=absolute') ? '/abs/.git\n/abs/.git\n' : '.git\n.git\n';
    });
    assert.deepEqual(await cli.resolveGitDirectories(), { gitDir: '/work/repo/.git', commonDir: '/work/repo/.git' });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].includes('--path-format=absolute'), false);
  });

  it('asks again after a failure', async () => {
    let attempts = 0;
    const { cli } = cliWith(() => {
      attempts += 1;
      if (attempts <= 2) {
        throw new Error('not a repository');
      }
      return '/work/repo/.git\n/work/repo/.git\n';
    });
    await assert.rejects(() => cli.resolveGitDirectories(), /not a repository/);
    assert.deepEqual(await cli.resolveGitDirectories(), { gitDir: '/work/repo/.git', commonDir: '/work/repo/.git' });
  });
});

describe('GitCli environment', { skip: process.platform === 'win32' }, () => {
  /** A `git` that prints the variable Git reads to decide whether a read may take locks. */
  function withFakeGit<T>(run: (cli: GitCli) => Promise<T>): Promise<T> {
    const dir = mkdtempSync(join(tmpdir(), 'git-checkout-fake-git-'));
    const script = join(dir, 'git');
    writeFileSync(script, '#!/bin/sh\nprintf "%s" "${GIT_OPTIONAL_LOCKS-unset}"\n');
    chmodSync(script, 0o755);
    return run(new GitCli(script, dir, new GitOperationQueue())).finally(() => rmSync(dir, { recursive: true, force: true }));
  }

  it('keeps reads from taking locks, so they cannot make a write fail', async () => {
    await withFakeGit(async (cli) => {
      assert.equal((await cli.execRead(['status'])).stdout, '0');
    });
  });

  it('leaves writes as they are, since they have to take locks', async () => {
    await withFakeGit(async (cli) => {
      assert.equal((await cli.execWrite(['add', '.'])).stdout, 'unset');
    });
  });

  it('lets a caller override it', async () => {
    await withFakeGit(async (cli) => {
      assert.equal((await cli.execRead(['status'], { env: { GIT_OPTIONAL_LOCKS: '1' } })).stdout, '1');
    });
  });
});
