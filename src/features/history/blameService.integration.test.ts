import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { annotateDiffLines } from '../../shared/history/blameAnnotation';
import { isUncommittedSha } from '../../shared/history/blameProtocol';
import { BlameService } from './blameService';
import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry } from '../../core/testing/serviceTestUtils';

describe('blame integration', () => {
  it('blames a file at HEAD and at an older revision',  async () => {
    const repo = initTempRepository();
    try {
      const file = join(repo.repoRoot, 'notes.txt');
      writeFileSync(file, 'one\n');
      runGit(repo.repoRoot, ['add', 'notes.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'add-notes']);
      const first = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();

      writeFileSync(file, 'one changed\n');
      runGit(repo.repoRoot, ['add', 'notes.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'edit-notes']);

      const service = new BlameService(mockCliRegistry(repo.repoRoot, repo.cli));
      const head = await service.loadLines(repo.repoRoot, {
        path: 'notes.txt',
        revision: '',
        startLine: 1,
      });
      assert.equal(head.lines[0]?.text, 'one changed');
      assert.match(head.lines[0]?.summary ?? '', /edit-notes/);
      assert.equal(head.hasMore, false);

      const older = await service.loadLines(repo.repoRoot, {
        path: 'notes.txt',
        revision: first,
        startLine: 1,
      });
      assert.equal(older.lines[0]?.text, 'one');
      assert.match(older.lines[0]?.summary ?? '', /add-notes/);

      writeFileSync(file, 'one changed\nuncommitted\n');
      service.invalidate(repo.repoRoot);
      const dirty = await service.loadLines(repo.repoRoot, {
        path: 'notes.txt',
        revision: '',
        startLine: 1,
      });
      assert.equal(dirty.lines[1]?.text, 'uncommitted');
      assert.equal(isUncommittedSha(dirty.lines[1]?.sha ?? ''), true);
      assert.equal(dirty.lines[1]?.groupStart, true);
    } finally {
      repo.cleanup();
    }
  });

  it('blames just the lines of a commit diff and pairs them with the commits that last changed them', async () => {
    const repo = initTempRepository();
    try {
      const file = join(repo.repoRoot, 'notes.txt');
      writeFileSync(file, 'one\ntwo\nthree\n');
      runGit(repo.repoRoot, ['add', 'notes.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'add-notes']);
      const first = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      writeFileSync(file, 'one\nTWO\nthree\n');
      runGit(repo.repoRoot, ['add', 'notes.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'edit-notes']);
      const second = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();

      const service = new BlameService(mockCliRegistry(repo.repoRoot, repo.cli));
      const after = await service.loadLineNumbers(repo.repoRoot, second, 'notes.txt', [1, 2, 3]);
      const before = await service.loadLineNumbers(repo.repoRoot, `${second}^`, 'notes.txt', [2]);
      assert.deepEqual(before.map((line) => line.line), [2], 'only the lines asked for');
      const diff = [
        { kind: 'context', text: 'one', line: 1 },
        { kind: 'del', text: 'two', line: 2 },
        { kind: 'add', text: 'TWO', line: 2 },
        { kind: 'context', text: 'three', line: 3 },
      ] as const;
      const result = annotateDiffLines([...diff], after, before);
      assert.deepEqual(result.shas, [first, first, second, first]);
      assert.equal(result.commits[second]?.summary, 'edit-notes');
      assert.equal(result.commits[first]?.summary, 'add-notes');
    } finally {
      repo.cleanup();
    }
  });
});
