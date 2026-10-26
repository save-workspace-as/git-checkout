import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { initTempRepository, runGit } from '../core/testing/gitRepoHarness';
import { repositoryKind, sidebarRepositoryRoots } from './sidebarRepositories';

function commitFile(repoRoot: string, name: string): void {
  writeFileSync(join(repoRoot, name), `${name}\n`);
  runGit(repoRoot, ['add', name]);
  runGit(repoRoot, ['commit', '-m', name]);
}

describe('repositoryKind', () => {
  it('tells a clone from a linked worktree and a submodule', () => {
    const source = initTempRepository();
    const repo = initTempRepository();
    const parent = mkdtempSync(join(tmpdir(), 'sidebar-repos-'));
    try {
      commitFile(source.repoRoot, 'lib.txt');
      commitFile(repo.repoRoot, 'a.txt');
      const worktree = join(parent, 'wt');
      runGit(repo.repoRoot, ['worktree', 'add', '-b', 'topic', worktree]);
      runGit(repo.repoRoot, ['-c', 'protocol.file.allow=always', 'submodule', 'add', source.repoRoot, 'libs']);

      assert.equal(repositoryKind(repo.repoRoot), 'repository');
      assert.equal(repositoryKind(worktree), 'worktree');
      assert.equal(repositoryKind(join(repo.repoRoot, 'libs')), 'submodule');
      assert.equal(repositoryKind(join(parent, 'missing')), 'repository');

      // vscode.git reports all of them; only the repository the user opened is listed.
      assert.deepEqual(
        sidebarRepositoryRoots(
          [worktree, join(repo.repoRoot, 'libs'), repo.repoRoot],
          [repo.repoRoot],
        ),
        [repo.repoRoot],
      );
    } finally {
      rmSync(parent, { recursive: true, force: true });
      repo.cleanup();
      source.cleanup();
    }
  });
});
