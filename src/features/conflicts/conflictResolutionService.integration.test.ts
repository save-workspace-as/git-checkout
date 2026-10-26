import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { ConflictResolutionService } from './conflictResolutionService';
import {
  GIT_TEST_IDENTITY_ENV,
  initTempRepository,
  runGit,
  runGitAllowFailure,
  seedDivergentFileConflict,
} from '../../core/testing/gitRepoHarness';
import { mockCliRegistry, mockGitExtensionService, mockRepository } from '../../core/testing/serviceTestUtils';

describe('ConflictResolutionService integration', () => {
  it('lists conflict files after a failed merge', async () => {
    const repo = initTempRepository();
    try {
      seedDivergentFileConflict(repo);
      const exitCode = runGitAllowFailure(repo.repoRoot, ['merge', 'other', '--no-commit']);
      assert.notEqual(exitCode, 0);

      const gitRepo = mockRepository(repo.repoRoot);
      const svc = new ConflictResolutionService(
        mockGitExtensionService([gitRepo]),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );

      const state = await svc.loadState(repo.repoRoot);
      assert.equal(state.operationKind, 'merge');
      assert.equal(state.files.length, 1);
      assert.equal(state.files[0]?.path, 'conflict.txt');
      assert.equal(state.files[0]?.badge, 'text');
      assert.equal(state.continueCommand, 'git merge --continue');
      assert.equal(state.abortCommand, 'git merge --abort');
    } finally {
      runGitAllowFailure(repo.repoRoot, ['merge', '--abort']);
      repo.cleanup();
    }
  });

  it('tells a binary conflict from a text one, and a file that only one side kept', async () => {
    const repo = initTempRepository();
    try {
      const write = (name: string, bytes: number[]): void => {
        writeFileSync(path.join(repo.repoRoot, name), Buffer.from(bytes));
        runGit(repo.repoRoot, ['add', name]);
      };
      writeFileSync(path.join(repo.repoRoot, 'notes.txt'), 'one\nbase\n');
      runGit(repo.repoRoot, ['add', 'notes.txt']);
      write('image.bin', [0, 1, 2, 3]);
      write('gone.bin', [0, 1, 1, 1]);
      runGit(repo.repoRoot, ['commit', '-m', 'base']);
      runGit(repo.repoRoot, ['checkout', '-b', 'other']);
      writeFileSync(path.join(repo.repoRoot, 'notes.txt'), 'one\nother\n');
      write('image.bin', [0, 9, 9, 9]);
      write('gone.bin', [0, 2, 2, 2]);
      runGit(repo.repoRoot, ['commit', '-am', 'other']);
      runGit(repo.repoRoot, ['checkout', '-']);
      writeFileSync(path.join(repo.repoRoot, 'notes.txt'), 'one\nmain\n');
      write('image.bin', [0, 7, 7, 7]);
      runGit(repo.repoRoot, ['rm', '-q', 'gone.bin']);
      runGit(repo.repoRoot, ['commit', '-am', 'main']);
      assert.notEqual(runGitAllowFailure(repo.repoRoot, ['merge', 'other', '--no-commit']), 0);

      const svc = new ConflictResolutionService(
        mockGitExtensionService([mockRepository(repo.repoRoot)]),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );
      const kinds = Object.fromEntries((await svc.loadState(repo.repoRoot)).files.map((file) => [file.path, file.kind]));
      assert.deepEqual(kinds, { 'gone.bin': 'binary', 'image.bin': 'binary', 'notes.txt': 'text' });
    } finally {
      runGitAllowFailure(repo.repoRoot, ['merge', '--abort']);
      repo.cleanup();
    }
  });

  it('lists a submodule pointer conflict with guidance, which the merge editor cannot show', async () => {
    const repo = initTempRepository();
    try {
      // runGit joins its arguments with spaces, so commit messages here are single words.
      // Two commits of the submodule that both build on the first, so the two sides cannot be merged.
      const lib = path.join(repo.repoRoot, '..', `${path.basename(repo.repoRoot)}-lib`);
      mkdirSync(lib);
      try {
        const env = { ...GIT_TEST_IDENTITY_ENV, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'protocol.file.allow', GIT_CONFIG_VALUE_0: 'always' };
        runGit(lib, ['init', '-q', '-b', 'main'], env);
        writeFileSync(path.join(lib, 'f'), '1\n');
        runGit(lib, ['add', 'f'], env);
        runGit(lib, ['commit', '-qm', 'one'], env);
        runGit(lib, ['checkout', '-qb', 'left'], env);
        writeFileSync(path.join(lib, 'f'), '2\n');
        runGit(lib, ['commit', '-qam', 'left'], env);
        runGit(lib, ['checkout', '-q', 'main'], env);
        runGit(lib, ['checkout', '-qb', 'right'], env);
        writeFileSync(path.join(lib, 'g'), '3\n');
        runGit(lib, ['add', 'g'], env);
        runGit(lib, ['commit', '-qm', 'right'], env);

        runGit(repo.repoRoot, ['submodule', 'add', '-q', lib, 'lib'], env);
        runGit(repo.repoRoot, ['-C', 'lib', 'checkout', '-q', 'main'], env);
        runGit(repo.repoRoot, ['commit', '-qam', 'submodule'], env);
        runGit(repo.repoRoot, ['checkout', '-qb', 'topic'], env);
        runGit(repo.repoRoot, ['-C', 'lib', 'checkout', '-q', 'left'], env);
        runGit(repo.repoRoot, ['commit', '-qam', 'topic-moves-lib'], env);
        runGit(repo.repoRoot, ['checkout', '-q', '-'], env);
        runGit(repo.repoRoot, ['-C', 'lib', 'checkout', '-q', 'right'], env);
        runGit(repo.repoRoot, ['commit', '-qam', 'main-moves-lib'], env);
        assert.notEqual(runGitAllowFailure(repo.repoRoot, ['merge', 'topic', '--no-commit']), 0);

        const svc = new ConflictResolutionService(
          mockGitExtensionService([mockRepository(repo.repoRoot)]),
          mockCliRegistry(repo.repoRoot, repo.cli),
        );
        const [file] = (await svc.loadState(repo.repoRoot)).files;
        assert.equal(file?.path, 'lib');
        assert.equal(file?.kind, 'submodule');
        assert.equal(file?.mergeEditorSupported, false);
        assert.match(file?.guidance ?? '', /git add lib/);
      } finally {
        rmSync(lib, { recursive: true, force: true });
      }
    } finally {
      runGitAllowFailure(repo.repoRoot, ['merge', '--abort']);
      repo.cleanup();
    }
  });

  describe('continue', () => {
    /** `topic` has two commits, `t1` and `t2`, that each change a file that `main` changed too. */
    function seedTwoConflictingCommits(repo: { repoRoot: string }): void {
      const write = (name: string, text: string): void => writeFileSync(path.join(repo.repoRoot, name), text);
      write('a', 'base\n');
      write('b', 'base\n');
      runGit(repo.repoRoot, ['add', '.']);
      runGit(repo.repoRoot, ['commit', '-qm', 'base']);
      runGit(repo.repoRoot, ['checkout', '-qb', 'topic']);
      write('a', 't1\n');
      runGit(repo.repoRoot, ['commit', '-qam', 't1']);
      write('b', 't2\n');
      runGit(repo.repoRoot, ['commit', '-qam', 't2']);
      runGit(repo.repoRoot, ['checkout', '-q', '-']);
      write('a', 'm1\n');
      runGit(repo.repoRoot, ['commit', '-qam', 'm1']);
      write('b', 'm2\n');
      runGit(repo.repoRoot, ['commit', '-qam', 'm2']);
      runGit(repo.repoRoot, ['checkout', '-q', 'topic']);
    }

    it('reports that a rebase stopped again when the next commit conflicts, and finishes after that one is fixed', async () => {
      const repo = initTempRepository();
      try {
        seedTwoConflictingCommits(repo);
        assert.notEqual(runGitAllowFailure(repo.repoRoot, ['rebase', 'main']), 0);
        const svc = new ConflictResolutionService(
          mockGitExtensionService([mockRepository(repo.repoRoot)]),
          mockCliRegistry(repo.repoRoot, repo.cli),
        );

        writeFileSync(path.join(repo.repoRoot, 'a'), 'both\n');
        runGit(repo.repoRoot, ['add', 'a']);
        assert.equal(await svc.continue(repo.repoRoot), 'stopped');
        const state = await svc.loadState(repo.repoRoot);
        assert.equal(state.operationKind, 'rebase');
        assert.deepEqual(state.files.map((file) => file.path), ['b']);

        writeFileSync(path.join(repo.repoRoot, 'b'), 'both\n');
        runGit(repo.repoRoot, ['add', 'b']);
        assert.equal(await svc.continue(repo.repoRoot), 'finished');
        assert.equal((await svc.loadState(repo.repoRoot)).operationKind, null);
      } finally {
        runGitAllowFailure(repo.repoRoot, ['rebase', '--abort']);
        repo.cleanup();
      }
    });

    it('does not continue while a file is still conflicted, and leaves the rebase where it was', async () => {
      const repo = initTempRepository();
      try {
        seedTwoConflictingCommits(repo);
        assert.notEqual(runGitAllowFailure(repo.repoRoot, ['rebase', 'main']), 0);
        const svc = new ConflictResolutionService(
          mockGitExtensionService([mockRepository(repo.repoRoot)]),
          mockCliRegistry(repo.repoRoot, repo.cli),
        );

        assert.equal(await svc.continue(repo.repoRoot), 'unresolved');
        const state = await svc.loadState(repo.repoRoot);
        assert.equal(state.operationKind, 'rebase');
        assert.deepEqual(state.files.map((file) => file.path), ['a']);
      } finally {
        runGitAllowFailure(repo.repoRoot, ['rebase', '--abort']);
        repo.cleanup();
      }
    });
  });

  it('aborts an in-progress merge', async () => {
    const repo = initTempRepository();
    try {
      seedDivergentFileConflict(repo);
      runGitAllowFailure(repo.repoRoot, ['merge', 'other', '--no-commit']);

      const gitRepo = mockRepository(repo.repoRoot);
      const svc = new ConflictResolutionService(
        mockGitExtensionService([gitRepo]),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );

      await svc.abort(repo.repoRoot);
      const state = await svc.loadState(repo.repoRoot);
      assert.equal(state.files.length, 0);
      assert.equal(state.allResolved, true);
    } finally {
      repo.cleanup();
    }
  });
});
