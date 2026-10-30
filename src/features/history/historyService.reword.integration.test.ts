import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { HistoryService } from './historyService';
import { initTempRepository, runGit, type TempGitRepository } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry } from '../../core/testing/serviceTestUtils';

async function setUp() {
  const repo = initTempRepository();
  const service = new HistoryService(mockCliRegistry(repo.repoRoot, repo.cli));
  const read = async (...args: string[]) => (await repo.cli.execRead(args)).stdout.trim();
  /** Commits `text` to `file` as someone else, on a fixed day, so a rewrite that loses either is seen. */
  const commit = async (file: string, text: string, message: string, day: number): Promise<string> => {
    writeFileSync(join(repo.repoRoot, file), text);
    runGit(repo.repoRoot, ['add', file]);
    await repo.cli.execWrite(['commit', '-m', message], {
      env: { GIT_AUTHOR_NAME: 'Ada Lovelace', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_AUTHOR_DATE: `2024-01-0${day}T10:00:00Z` },
    });
    return read('rev-parse', 'HEAD');
  };
  return { repo, service, read, commit };
}

/** The subject, author and tree of every commit, newest first. */
async function history(repo: TempGitRepository): Promise<string[]> {
  return (await repo.cli.execRead(['log', '--format=%s|%an|%aI|%T'])).stdout.trim().split('\n');
}

describe('HistoryService edit commit message', () => {
  it('rewords a commit in the middle and keeps its author, its date and every tree', async () => {
    const { repo, service, read, commit } = await setUp();
    try {
      await commit('a.txt', 'a\n', 'first', 1);
      const middle = await commit('b.txt', 'b\n', 'second', 2);
      await commit('c.txt', 'c\n', 'third', 3);
      const before = await history(repo);

      await service.rewordCommit(repo.repoRoot, middle, 'second, reworded\n\nwith a body');

      const after = await history(repo);
      assert.deepEqual(after.map((line) => line.split('|').slice(1).join('|')), before.map((line) => line.split('|').slice(1).join('|')), 'authors, dates and trees are the same');
      assert.deepEqual(after.map((line) => line.split('|')[0]), ['third', 'second, reworded', 'first']);
      assert.equal(await read('log', '-1', '--format=%B', 'HEAD~1'), 'second, reworded\n\nwith a body');
      assert.equal(await read('status', '--porcelain'), '');
      assert.equal(await read('symbolic-ref', '--short', 'HEAD'), 'main');
    } finally {
      repo.cleanup();
    }
  });

  it('rewords the first commit of the history', async () => {
    const { repo, service, read, commit } = await setUp();
    try {
      const root = await commit('a.txt', 'a\n', 'first', 1);
      await commit('b.txt', 'b\n', 'second', 2);
      await service.rewordCommit(repo.repoRoot, root, 'the very first');
      assert.deepEqual((await history(repo)).map((line) => line.split('|')[0]), ['second', 'the very first']);
      assert.equal(await read('rev-list', '--max-parents=0', '--count', 'HEAD'), '1');
    } finally {
      repo.cleanup();
    }
  });

  it('rewords the last commit by its message only, even with changes staged', async () => {
    const { repo, service, read, commit } = await setUp();
    try {
      await commit('a.txt', 'a\n', 'first', 1);
      const last = await commit('b.txt', 'b\n', 'second', 2);
      writeFileSync(join(repo.repoRoot, 'staged.txt'), 'x\n');
      runGit(repo.repoRoot, ['add', 'staged.txt']);

      await service.rewordCommit(repo.repoRoot, last, 'second, reworded');

      assert.equal(await read('log', '-1', '--format=%s'), 'second, reworded');
      assert.equal(await read('show', '--name-only', '--format=', 'HEAD'), 'b.txt', 'the staged file is not in the commit');
      assert.equal(await read('status', '--porcelain'), 'A  staged.txt', 'and it is still staged');
    } finally {
      repo.cleanup();
    }
  });

  it('keeps local changes when it rewords an older commit', async () => {
    const { repo, service, read, commit } = await setUp();
    try {
      const first = await commit('a.txt', 'a\n', 'first', 1);
      await commit('b.txt', 'b\n', 'second', 2);
      writeFileSync(join(repo.repoRoot, 'a.txt'), 'a, edited\n');

      await service.rewordCommit(repo.repoRoot, first, 'first, reworded');

      assert.equal(readFileSync(join(repo.repoRoot, 'a.txt'), 'utf8'), 'a, edited\n');
      assert.equal(await read('status', '--porcelain'), 'M a.txt');
      assert.equal(await read('log', '--format=%s', '-2'), 'second\nfirst, reworded');
    } finally {
      repo.cleanup();
    }
  });

  it('refuses an empty message and leaves the history alone', async () => {
    const { repo, service, read, commit } = await setUp();
    try {
      const first = await commit('a.txt', 'a\n', 'first', 1);
      await commit('b.txt', 'b\n', 'second', 2);
      const before = await read('rev-parse', 'HEAD');
      await assert.rejects(service.rewordCommit(repo.repoRoot, first, '  \n'));
      assert.equal(await read('rev-parse', 'HEAD'), before);
    } finally {
      repo.cleanup();
    }
  });
});

describe('HistoryService commit message info', () => {
  it('gives the whole message and the remote branches that have the commit', async () => {
    const { repo, service, read, commit } = await setUp();
    try {
      const first = await commit('a.txt', 'a\n', 'first\n\nbody', 1);
      await commit('b.txt', 'b\n', 'second', 2);
      runGit(repo.repoRoot, ['update-ref', 'refs/remotes/origin/main', first]);

      const info = await service.commitMessageInfo(repo.repoRoot, first);
      assert.equal(info.message, 'first\n\nbody');
      assert.equal(info.subject, 'first');
      assert.deepEqual(info.pushedTo, ['origin/main']);
      assert.equal(info.problem, undefined);
      assert.deepEqual((await service.commitMessageInfo(repo.repoRoot, await read('rev-parse', 'HEAD'))).pushedTo, []);
    } finally {
      repo.cleanup();
    }
  });

  it('says why a commit cannot be edited: another branch has it, or a merge follows it', async () => {
    const { repo, service, read, commit } = await setUp();
    try {
      const base = await commit('a.txt', 'a\n', 'base', 1);
      runGit(repo.repoRoot, ['checkout', '-b', 'topic']);
      const onTopic = await commit('t.txt', 't\n', 'topic work', 2);
      runGit(repo.repoRoot, ['checkout', 'main']);
      await commit('m.txt', 'm\n', 'main work', 3);

      assert.match((await service.commitMessageInfo(repo.repoRoot, onTopic)).problem ?? '', /checked-out branch/);

      await repo.cli.execWrite(['merge', '--no-ff', 'topic', '-m', 'merge topic']);
      const merged = await service.commitMessageInfo(repo.repoRoot, base);
      assert.match(merged.problem ?? '', /merge commit/);
      assert.equal(await read('rev-list', '--merges', '--count', 'HEAD'), '1');
    } finally {
      repo.cleanup();
    }
  });
});
