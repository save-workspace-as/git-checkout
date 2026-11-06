import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { HistoryService } from './historyService';
import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
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

describe('HistoryService fixup into a commit', () => {
  it('folds the staged change into a commit in the middle, keeping its message and author, and leaves other edits alone', async () => {
    const { repo, service, read, commit } = await setUp();
    try {
      await commit('a.txt', 'a\n', 'first', 1);
      const middle = await commit('b.txt', 'b\n', 'second', 2);
      await commit('c.txt', 'c\n', 'third', 3);
      writeFileSync(join(repo.repoRoot, 'b.txt'), 'b, fixed\n');
      runGit(repo.repoRoot, ['add', 'b.txt']);
      writeFileSync(join(repo.repoRoot, 'a.txt'), 'a, still being edited\n');

      await service.fixupCommit(repo.repoRoot, middle);

      assert.equal(await read('log', '--format=%s'), 'third\nsecond\nfirst');
      assert.equal(await read('show', 'HEAD~1:b.txt'), 'b, fixed');
      assert.equal(await read('log', '-1', '--format=%an|%aI', 'HEAD~1'), 'Ada Lovelace|2024-01-02T10:00:00Z');
      assert.equal(readFileSync(join(repo.repoRoot, 'a.txt'), 'utf8'), 'a, still being edited\n');
      assert.equal(await read('status', '--porcelain'), 'M a.txt');
      assert.equal(await read('symbolic-ref', '--short', 'HEAD'), 'main');
    } finally {
      repo.cleanup();
    }
  });

  it('folds into the first commit of the history', async () => {
    const { repo, service, read, commit } = await setUp();
    try {
      const root = await commit('a.txt', 'a\n', 'first', 1);
      await commit('b.txt', 'b\n', 'second', 2);
      writeFileSync(join(repo.repoRoot, 'a.txt'), 'a, fixed\n');
      runGit(repo.repoRoot, ['add', 'a.txt']);
      await service.fixupCommit(repo.repoRoot, root);
      assert.equal(await read('log', '--format=%s'), 'second\nfirst');
      assert.equal(await read('show', 'HEAD~1:a.txt'), 'a, fixed');
    } finally {
      repo.cleanup();
    }
  });
});

describe('HistoryService squash into the parent', () => {
  it('melts a commit into its parent under one message, keeping the parent author and the later commits', async () => {
    const { repo, service, read, commit } = await setUp();
    try {
      await commit('a.txt', 'a\n', 'first', 1);
      await commit('b.txt', 'b\n', 'second', 2);
      const third = await commit('c.txt', 'c\n', 'third', 3);
      await commit('d.txt', 'd\n', 'fourth', 4);
      const treeBefore = await read('rev-parse', 'HEAD^{tree}');

      await service.squashIntoParent(repo.repoRoot, third, 'second and third');

      assert.equal(await read('log', '--format=%s'), 'fourth\nsecond and third\nfirst');
      assert.equal(await read('rev-parse', 'HEAD^{tree}'), treeBefore);
      assert.equal(await read('log', '-1', '--format=%an|%aI', 'HEAD~1'), 'Ada Lovelace|2024-01-02T10:00:00Z');
      assert.equal(await read('status', '--porcelain'), '');
    } finally {
      repo.cleanup();
    }
  });

  it('squashes the last commit, and refuses the first one, which has no parent', async () => {
    const { repo, service, read, commit } = await setUp();
    try {
      const root = await commit('a.txt', 'a\n', 'first', 1);
      const second = await commit('b.txt', 'b\n', 'second', 2);
      await assert.rejects(service.squashIntoParent(repo.repoRoot, root, 'x'), /no parent/);
      await assert.rejects(service.squashIntoParent(repo.repoRoot, second, '  '), /non-empty/);
      await service.squashIntoParent(repo.repoRoot, second, 'both');
      assert.equal(await read('log', '--format=%s'), 'both');
    } finally {
      repo.cleanup();
    }
  });

  it('says why a commit cannot be rewritten: another branch, or a merge after it', async () => {
    const { repo, service, commit } = await setUp();
    try {
      await commit('a.txt', 'a\n', 'first', 1);
      runGit(repo.repoRoot, ['checkout', '-q', '-b', 'side']);
      const side = await commit('s.txt', 's\n', 'side', 2);
      runGit(repo.repoRoot, ['checkout', '-q', 'main']);
      const onMain = await commit('m.txt', 'm\n', 'main', 3);
      assert.match((await service.rewriteProblem(repo.repoRoot, side)) ?? '', /checked-out branch/);
      assert.equal(await service.rewriteProblem(repo.repoRoot, onMain), undefined);
      runGit(repo.repoRoot, ['merge', '--no-ff', '-m', 'merged', 'side']);
      assert.match((await service.rewriteProblem(repo.repoRoot, onMain)) ?? '', /merge commit/);
    } finally {
      repo.cleanup();
    }
  });
});

describe('HistoryService split a commit', () => {
  it('stops at the commit with its changes unstaged, and the rebase continues once they are committed in parts', async () => {
    const { repo, service, read, commit } = await setUp();
    try {
      await commit('a.txt', 'a\n', 'first', 1);
      // One commit that holds two files.
      writeFileSync(join(repo.repoRoot, 'b.txt'), 'b\n');
      writeFileSync(join(repo.repoRoot, 'c.txt'), 'c\n');
      runGit(repo.repoRoot, ['add', 'b.txt', 'c.txt']);
      await repo.cli.execWrite(['commit', '-m', 'second']);
      const middle = await read('rev-parse', 'HEAD');
      await commit('d.txt', 'd\n', 'last', 3);

      await service.startSplit(repo.repoRoot, middle);

      assert.equal(await read('status', '--porcelain'), '?? b.txt\n?? c.txt');
      assert.equal(await read('log', '-1', '--format=%s'), 'first');
      runGit(repo.repoRoot, ['add', 'b.txt']);
      await repo.cli.execWrite(['commit', '-m', 'second-b']);
      runGit(repo.repoRoot, ['add', 'c.txt']);
      await repo.cli.execWrite(['commit', '-m', 'second-c']);
      await repo.cli.execWrite(['rebase', '--continue']);

      assert.equal(await read('log', '--format=%s'), 'last\nsecond-c\nsecond-b\nfirst');
      assert.equal(await read('status', '--porcelain'), '');
    } finally {
      repo.cleanup();
    }
  });

  it('refuses the first commit, which has no parent to replay from', async () => {
    const { repo, service, commit } = await setUp();
    try {
      await commit('a.txt', 'a\n', 'first', 1);
      const root = (await repo.cli.execRead(['rev-list', '--max-parents=0', 'HEAD'])).stdout.trim();
      await assert.rejects(service.startSplit(repo.repoRoot, root), /cannot be split/);
    } finally {
      repo.cleanup();
    }
  });
});
