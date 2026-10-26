import { strict as assert } from 'node:assert';
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { initTempRepository } from '../../core/testing/gitRepoHarness';
import {
  mockCliRegistry,
  mockExtensionContext,
  mockGitExtensionService,
  mockRepository,
} from '../../core/testing/serviceTestUtils';
import { CommitGraphService } from './commitGraphService';
import { graphRefresher } from './graphRefresh';

/** A straight line of `count` commits on `main`, written in one go. */
function seedHistory(repoRoot: string, count: number): void {
  let script = '';
  for (let i = 1; i <= count; i++) {
    const message = `commit ${i}`;
    script += `commit refs/heads/main\nmark :${i}\ncommitter Test <test@example.com> ${1_000_000 + i} +0000\n`
      + `data ${message.length}\n${message}\n${i > 1 ? `from :${i - 1}\n` : ''}\n`;
  }
  execSync('git fast-import --quiet', { cwd: repoRoot, input: script });
  execSync('git checkout -q main', { cwd: repoRoot });
}

describe('graph refresh', () => {
  it('keeps the place of someone scrolled deep when two refreshes start at once', async () => {
    const repo = initTempRepository();
    try {
      seedHistory(repo.repoRoot, 600);
      const graph = new CommitGraphService(
        mockExtensionContext(),
        mockGitExtensionService([mockRepository(repo.repoRoot)], { headName: 'main' }),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );
      // The person has scrolled several pages down.
      const deep = (await graph.loadInitialThrough(repo.repoRoot, 500)).commits.length;
      const posted: { keepView: boolean; shas: string[] }[] = [];
      const refresh = graphRefresher(() => graph, () => repo.repoRoot, async (keepDepth) => {
        const page = keepDepth > 0
          ? await graph.loadInitialThrough(repo.repoRoot, keepDepth)
          : await graph.loadInitial(repo.repoRoot);
        posted.push({ keepView: keepDepth > 0, shas: page.commits.map((commit) => commit.sha) });
      });

      // A file watcher and vscode.git both report the same change.
      await Promise.all([refresh(), refresh()]);

      assert.ok(posted.length > 0);
      for (const page of posted) {
        assert.equal(page.keepView, true, 'no refresh starts the view over from the top');
        assert.equal(page.shas.length, deep, 'as deep as it was');
        assert.equal(new Set(page.shas).size, page.shas.length, 'no commit twice');
      }
    } finally {
      repo.cleanup();
    }
  });

  it('reloads only when a ref or HEAD moved, unless forced', async () => {
    const repo = initTempRepository();
    try {
      seedHistory(repo.repoRoot, 100);
      const graph = new CommitGraphService(
        mockExtensionContext(),
        mockGitExtensionService([mockRepository(repo.repoRoot)], { headName: 'main' }),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );
      await graph.loadInitial(repo.repoRoot);
      let reloads = 0;
      const refresh = graphRefresher(() => graph, () => repo.repoRoot, async (keepDepth) => {
        reloads += 1;
        await graph.loadInitialThrough(repo.repoRoot, keepDepth);
      });

      await refresh();
      assert.equal(reloads, 1, 'the first refresh has nothing to compare with');
      // A saved file or a staged change: no ref moved.
      writeFileSync(join(repo.repoRoot, 'edited.txt'), 'x');
      execSync('git add edited.txt', { cwd: repo.repoRoot });
      await refresh();
      assert.equal(reloads, 1, 'nothing the graph shows changed');
      await refresh(true);
      assert.equal(reloads, 2, 'the Refresh command reloads anyway');
      execSync('git -c user.name=T -c user.email=t@t commit -q -m more', { cwd: repo.repoRoot });
      await refresh();
      assert.equal(reloads, 3, 'a new commit moved the branch');
      execSync('git branch side', { cwd: repo.repoRoot });
      await refresh();
      assert.equal(reloads, 4, 'a new branch is a new label');
      execSync('git checkout -q side', { cwd: repo.repoRoot });
      await refresh();
      assert.equal(reloads, 5, 'switching branch moves the current-branch mark, though HEAD is the same commit');
    } finally {
      repo.cleanup();
    }
  });
});

