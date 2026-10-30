import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry } from '../../core/testing/serviceTestUtils';
import { isUncommittedSha } from '../../shared/history/blameProtocol';
import { LineBlameService } from './lineBlameService';

describe('LineBlameService integration', () => {
  it('blames each line on its commit, and a line edited but not committed on nobody', async () => {
    const repo = initTempRepository();
    try {
      const file = join(repo.repoRoot, 'notes.txt');
      writeFileSync(file, 'one\ntwo\n');
      runGit(repo.repoRoot, ['add', 'notes.txt']);
      await repo.cli.execWrite(['commit', '-m', 'add notes (#3)\n\nbody text']);
      const service = new LineBlameService(mockCliRegistry(repo.repoRoot, repo.cli));

      const committed = await service.blameFile(repo.repoRoot, 'notes.txt');
      assert.equal(committed?.size, 2);
      const first = committed?.get(1);
      assert.equal(first?.summary, 'add notes (#3)');
      assert.ok(first && !isUncommittedSha(first.sha) && first.author.length > 0);
      assert.equal(first.path, 'notes.txt');

      writeFileSync(file, 'one\nTWO\n');
      service.invalidate(repo.repoRoot);
      const edited = await service.blameFile(repo.repoRoot, 'notes.txt');
      assert.equal(edited?.get(1)?.sha, first.sha);
      assert.ok(isUncommittedSha(edited?.get(2)?.sha ?? ''));

      const commit = await service.commit(repo.repoRoot, first.sha);
      assert.equal(commit?.sha, first.sha);
      assert.equal(commit?.message, 'add notes (#3)\n\nbody text');
    } finally {
      repo.cleanup();
    }
  });

  it('names the file as it was called in the commit that last changed a line', async () => {
    const repo = initTempRepository();
    try {
      writeFileSync(join(repo.repoRoot, 'old.txt'), 'one\ntwo\n');
      runGit(repo.repoRoot, ['add', 'old.txt']);
      await repo.cli.execWrite(['commit', '-m', 'add']);
      runGit(repo.repoRoot, ['mv', 'old.txt', 'new.txt']);
      writeFileSync(join(repo.repoRoot, 'new.txt'), 'one\nTWO\n');
      runGit(repo.repoRoot, ['add', 'new.txt']);
      await repo.cli.execWrite(['commit', '-m', 'rename and edit']);
      const service = new LineBlameService(mockCliRegistry(repo.repoRoot, repo.cli));
      const line = (await service.blameFile(repo.repoRoot, 'new.txt'))?.get(2);
      assert.equal(line?.summary, 'rename and edit');
      assert.equal(line?.path, 'new.txt');
      assert.equal((await service.blameFile(repo.repoRoot, 'new.txt'))?.get(1)?.path, 'old.txt', 'the line that was not touched keeps the old name');
    } finally {
      repo.cleanup();
    }
  });

  it('blames the text of an editor that has unsaved edits, not the file on disk', async () => {
    const repo = initTempRepository();
    try {
      writeFileSync(join(repo.repoRoot, 'notes.txt'), 'one\ntwo\n');
      runGit(repo.repoRoot, ['add', 'notes.txt']);
      await repo.cli.execWrite(['commit', '-m', 'add notes']);
      const service = new LineBlameService(mockCliRegistry(repo.repoRoot, repo.cli));
      const committed = await service.blameFile(repo.repoRoot, 'notes.txt');

      const typed = await service.blameFile(repo.repoRoot, 'notes.txt', 'new first line\none\ntwo\n');
      assert.equal(typed?.size, 3);
      assert.ok(isUncommittedSha(typed?.get(1)?.sha ?? ''), 'the line that was typed');
      assert.equal(typed?.get(2)?.sha, committed?.get(1)?.sha, 'the lines that moved down keep their commit');
      assert.equal(typed?.get(3)?.sha, committed?.get(2)?.sha);
    } finally {
      repo.cleanup();
    }
  });

  it('has no blame for a file git does not track, and no commit for a hash it does not know', async () => {
    const repo = initTempRepository();
    try {
      writeFileSync(join(repo.repoRoot, 'new.txt'), 'x\n');
      const service = new LineBlameService(mockCliRegistry(repo.repoRoot, repo.cli));
      assert.equal(await service.blameFile(repo.repoRoot, 'new.txt'), undefined);
      assert.equal(await service.commit(repo.repoRoot, 'deadbeefdeadbeef'), undefined);
    } finally {
      repo.cleanup();
    }
  });
});
