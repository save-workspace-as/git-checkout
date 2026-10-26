import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { initTempRepository, runGit, runGitAllowFailure } from '../../core/testing/gitRepoHarness';
import { PathHistoryService } from './pathHistoryService';
import { mockCliRegistry } from '../../core/testing/serviceTestUtils';

describe('path history', () => {
  it('pages file history, follows renames, includes merges on request, and resets a file', async () => {
    const repo = initTempRepository();
    try {
      const notes = join(repo.repoRoot, 'notes.txt');
      writeFileSync(notes, 'one\n');
      runGit(repo.repoRoot, ['add', 'notes.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'add-notes']);

      writeFileSync(notes, 'one\ntwo\n');
      runGit(repo.repoRoot, ['add', 'notes.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'extend-notes']);

      runGit(repo.repoRoot, ['branch', 'side']);
      writeFileSync(join(repo.repoRoot, 'other.txt'), 'main-only\n');
      runGit(repo.repoRoot, ['add', 'other.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'main-only']);
      writeFileSync(notes, 'one\nMAIN\n');
      runGit(repo.repoRoot, ['add', 'notes.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'main-notes']);

      runGit(repo.repoRoot, ['checkout', 'side']);
      writeFileSync(notes, 'one\nSIDE\n');
      runGit(repo.repoRoot, ['add', 'notes.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'side-notes']);
      runGit(repo.repoRoot, ['checkout', 'main']);
      assert.notEqual(runGitAllowFailure(repo.repoRoot, ['merge', '--no-ff', 'side']), 0);
      writeFileSync(notes, 'one\nMERGED\n');
      runGit(repo.repoRoot, ['add', 'notes.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'merge-notes']);

      runGit(repo.repoRoot, ['mv', 'notes.txt', 'docs.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'rename-notes']);

      const service = new PathHistoryService(mockCliRegistry(repo.repoRoot, repo.cli));
      const hidden = await service.loadPage(repo.repoRoot, {
        scope: 'file',
        path: 'docs.txt',
        follow: false,
        includeMerges: false,
        skip: 0,
      });
      assert.deepEqual(
        hidden.commits.map((commit) => commit.subject),
        ['rename-notes'],
      );

      const followed = await service.loadPage(repo.repoRoot, {
        scope: 'file',
        path: 'docs.txt',
        follow: true,
        includeMerges: false,
        skip: 0,
      });
      const followedSubjects = followed.commits.map((commit) => commit.subject);
      assert.ok(followedSubjects.includes('add-notes'));
      assert.ok(!followedSubjects.includes('merge-notes'));

      const withMerges = await service.loadPage(repo.repoRoot, {
        scope: 'file',
        path: 'docs.txt',
        follow: true,
        includeMerges: true,
        skip: 0,
      });
      const mergeRows = withMerges.commits.filter((commit) => commit.subject === 'merge-notes');
      assert.equal(mergeRows.length, 1);
      const withoutMerges = await service.loadPage(repo.repoRoot, {
        scope: 'file',
        path: 'docs.txt',
        follow: true,
        includeMerges: false,
        skip: 0,
      });
      assert.ok(!withoutMerges.commits.some((commit) => commit.subject === 'merge-notes'));

      const firstPage = await service.loadPage(repo.repoRoot, {
        scope: 'file',
        path: 'docs.txt',
        follow: true,
        includeMerges: true,
        skip: 0,
        limit: 1,
      });
      assert.equal(firstPage.commits.length, 1);
      assert.equal(firstPage.hasMore, true);
      const secondPage = await service.loadPage(repo.repoRoot, {
        scope: 'file',
        path: 'docs.txt',
        follow: true,
        includeMerges: true,
        skip: 1,
        limit: 1,
      });
      assert.notEqual(secondPage.commits[0]?.sha, firstPage.commits[0]?.sha);

      const directory = await service.loadPage(repo.repoRoot, {
        scope: 'directory',
        path: '.',
        follow: true,
        includeMerges: false,
        skip: 0,
      });
      assert.ok(directory.commits.some((commit) => commit.subject === 'main-only'));

      const hunk = await service.loadPage(repo.repoRoot, {
        scope: 'hunk',
        path: 'docs.txt',
        startLine: 2,
        endLine: 2,
        follow: false,
        includeMerges: false,
        skip: 0,
      });
      assert.ok(hunk.commits.some((commit) => commit.subject === 'side-notes'));

      const renamed = followed.commits.find((commit) => commit.subject === 'rename-notes');
      assert.ok(renamed);
      const docs = join(repo.repoRoot, 'docs.txt');
      writeFileSync(docs, 'dirty\n');
      await service.resetFile(repo.repoRoot, renamed.sha, 'docs.txt');
      assert.equal(readFileSync(docs, 'utf8'), 'one\nMERGED\n');
    } finally {
      repo.cleanup();
    }
  });
});
