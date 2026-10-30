import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { LineBlameService } from '../blame/lineBlameService';
import { initTempRepository, runGit, type TempGitRepository } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry } from '../../core/testing/serviceTestUtils';
import { BlameService } from './blameService';

async function setUp() {
  const repo = initTempRepository();
  const read = async (...args: string[]) => (await repo.cli.execRead(args)).stdout.trim();
  const commit = async (file: string, text: string, message: string, day: number): Promise<string> => {
    writeFileSync(join(repo.repoRoot, file), text);
    runGit(repo.repoRoot, ['add', '-A']);
    await repo.cli.execWrite(['commit', '-m', message], {
      env: { GIT_AUTHOR_NAME: 'Ada', GIT_AUTHOR_EMAIL: 'ada@example.com', GIT_AUTHOR_DATE: `2024-01-0${day}T10:00:00Z`, GIT_COMMITTER_DATE: `2024-01-0${day}T10:00:00Z` },
    });
    return read('rev-parse', 'HEAD');
  };
  const blame = new BlameService(mockCliRegistry(repo.repoRoot, repo.cli), undefined, () => true);
  return { repo, read, commit, blame };
}

const lines = (...text: string[]): string => `${text.join('\n')}\n`;

describe('BlameService previousChange', () => {
  it('names the commit that last changed a line before the commit that changed it', async () => {
    const { repo, commit, blame } = await setUp();
    try {
      const first = await commit('a.txt', lines('one', 'two', 'three'), 'first', 1);
      const second = await commit('a.txt', lines('one', 'TWO', 'three'), 'second', 2);
      const third = await commit('a.txt', lines('one', 'TWO!', 'three'), 'third', 3);

      const before = await blame.previousChange(repo.repoRoot, third, 'a.txt', 2);
      assert.deepEqual(before, { sha: second, path: 'a.txt', line: 2 });
      assert.deepEqual(await blame.previousChange(repo.repoRoot, second, 'a.txt', 2), { sha: first, path: 'a.txt', line: 2 });
      assert.equal(await blame.previousChange(repo.repoRoot, first, 'a.txt', 2), undefined, 'the first commit has nothing before it');
    } finally {
      repo.cleanup();
    }
  });

  it('follows the line through changes above it and has nothing for a line that was only added', async () => {
    const { repo, commit, blame } = await setUp();
    try {
      const first = await commit('a.txt', lines('one', 'two', 'three'), 'first', 1);
      const second = await commit('a.txt', lines('zero', 'one', 'two', 'three'), 'insert above', 2);
      const third = await commit('a.txt', lines('zero', 'one', 'two', 'three', 'four'), 'append', 3);
      // "three" is line 4 now; the change before the last one that touched it is the commit that wrote it.
      assert.deepEqual(await blame.previousChange(repo.repoRoot, third, 'a.txt', 4), { sha: first, path: 'a.txt', line: 3 });
      assert.equal(await blame.previousChange(repo.repoRoot, third, 'a.txt', 5), undefined, 'line 5 was added by the third commit');
      assert.equal(await blame.previousChange(repo.repoRoot, second, 'a.txt', 1), undefined, 'line 1 was added by the second');
    } finally {
      repo.cleanup();
    }
  });

  it('follows a rename, and says the name the file had', async () => {
    const { repo, commit, blame, read } = await setUp();
    try {
      const first = await commit('old.txt', lines('alpha', 'beta', 'gamma', 'delta'), 'first', 1);
      runGit(repo.repoRoot, ['mv', 'old.txt', 'new.txt']);
      const renamed = await commit('new.txt', lines('alpha', 'beta', 'GAMMA', 'delta'), 'rename and edit', 2);
      assert.equal(await read('log', '-1', '--format=%s'), 'rename and edit');
      assert.deepEqual(await blame.previousChange(repo.repoRoot, renamed, 'new.txt', 3), { sha: first, path: 'old.txt', line: 3 });
    } finally {
      repo.cleanup();
    }
  });
});

async function reformatted(repo: TempGitRepository, commit: (file: string, text: string, message: string, day: number) => Promise<string>) {
  const original = await commit('a.txt', lines('keep', 'logic'), 'write the logic', 1);
  const reformat = await commit('a.txt', lines('keep', '  logic'), 'reformat', 2);
  writeFileSync(join(repo.repoRoot, '.git-blame-ignore-revs'), `# bulk change\n${reformat}\n`);
  return { original, reformat };
}

describe('blame and .git-blame-ignore-revs', () => {
  it('blames a line on the commit before a bulk change that the file lists, when the setting is on', async () => {
    const { repo, commit } = await setUp();
    try {
      const { original, reformat } = await reformatted(repo, commit);
      const cli = mockCliRegistry(repo.repoRoot, repo.cli);

      const on = await new LineBlameService(cli, () => true).blameFile(repo.repoRoot, 'a.txt');
      assert.equal(on?.get(1)?.sha, original);
      assert.equal(on?.get(2)?.sha, original, 'the reformatted line is blamed on the commit that wrote it');

      const off = await new LineBlameService(cli, () => false).blameFile(repo.repoRoot, 'a.txt');
      assert.equal(off?.get(2)?.sha, reformat);

      const modal = await new BlameService(cli, undefined, () => true).loadLines(repo.repoRoot, { path: 'a.txt', revision: '', startLine: 1 });
      assert.equal(modal.lines[1]?.sha, original);
      const modalOff = await new BlameService(cli).loadLines(repo.repoRoot, { path: 'a.txt', revision: '', startLine: 1 });
      assert.equal(modalOff.lines[1]?.sha, reformat);
    } finally {
      repo.cleanup();
    }
  });

  it('still blames when the file names a commit this clone does not have', async () => {
    const { repo, commit } = await setUp();
    try {
      const original = await commit('a.txt', lines('one'), 'first', 1);
      writeFileSync(join(repo.repoRoot, '.git-blame-ignore-revs'), `${'f'.repeat(40)}\n`);
      const blame = await new LineBlameService(mockCliRegistry(repo.repoRoot, repo.cli), () => true).blameFile(repo.repoRoot, 'a.txt');
      assert.equal(blame?.get(1)?.sha, original);
    } finally {
      repo.cleanup();
    }
  });

  it('does nothing when the repository has no such file', async () => {
    const { repo, commit } = await setUp();
    try {
      const original = await commit('a.txt', lines('one'), 'first', 1);
      const blame = await new LineBlameService(mockCliRegistry(repo.repoRoot, repo.cli), () => true).blameFile(repo.repoRoot, 'a.txt');
      assert.equal(blame?.get(1)?.sha, original);
    } finally {
      repo.cleanup();
    }
  });
});
