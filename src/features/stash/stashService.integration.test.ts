import { strict as assert } from 'node:assert';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { PatchStagingService } from '../changes/patchStagingService';
import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry, mockGitExtensionService, mockRepository } from '../../core/testing/serviceTestUtils';
import { StashService } from './stashService';

function status(repoRoot: string, cli: { execRead(args: string[]): Promise<{ stdout: string }> }): Promise<string> {
  return cli.execRead(['status', '--porcelain']).then((result) => result.stdout.trim());
}

describe('StashService integration', () => {
  it('renames the newest stash without leaving a duplicate or dropping its neighbors', async () => {
    const repo = initTempRepository();
    try {
      const file = join(repo.repoRoot, 'notes.txt');
      writeFileSync(file, 'base\n');
      runGit(repo.repoRoot, ['add', 'notes.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'base']);
      const svc = new StashService(mockCliRegistry(repo.repoRoot, repo.cli));

      writeFileSync(file, 'first\n');
      await svc.create(repo.repoRoot, { mode: 'all', message: 'first stash', includeUntracked: false });
      writeFileSync(file, 'second\n');
      await svc.create(repo.repoRoot, { mode: 'all', message: 'second stash', includeUntracked: false });

      await svc.rename(repo.repoRoot, 'stash@{0}', 'renamed newest');

      const entries = await svc.list(repo.repoRoot);
      assert.deepEqual(entries.map((entry) => entry.message), ['renamed newest', 'On main: first stash']);
    } finally {
      repo.cleanup();
    }
  });

  it('renames a stash message and leaves neighboring stash entries intact', async () => {
    const repo = initTempRepository();
    try {
      const file = join(repo.repoRoot, 'notes.txt');
      writeFileSync(file, 'base\n');
      runGit(repo.repoRoot, ['add', 'notes.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'base']);
      const svc = new StashService(mockCliRegistry(repo.repoRoot, repo.cli));

      writeFileSync(file, 'first\n');
      await svc.create(repo.repoRoot, { mode: 'all', message: 'first stash', includeUntracked: false });
      writeFileSync(file, 'second\n');
      await svc.create(repo.repoRoot, { mode: 'all', message: 'second stash', includeUntracked: false });

      await svc.rename(repo.repoRoot, 'stash@{1}', 'renamed stash');

      const entries = await svc.list(repo.repoRoot);
      assert.deepEqual(entries.map((entry) => entry.message), ['renamed stash', 'On main: second stash']);
    } finally {
      repo.cleanup();
    }
  });

  it('restores staged and unstaged changes with apply --index', async () => {
    const repo = initTempRepository();
    try {
      const file = join(repo.repoRoot, 'notes.txt');
      writeFileSync(file, 'base\n');
      runGit(repo.repoRoot, ['add', 'notes.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'base']);
      writeFileSync(file, 'base\nstaged\n');
      runGit(repo.repoRoot, ['add', 'notes.txt']);
      writeFileSync(file, 'base\nstaged\nunstaged\n');

      const svc = new StashService(mockCliRegistry(repo.repoRoot, repo.cli));
      await svc.create(repo.repoRoot, { mode: 'all', message: 'wip', includeUntracked: false });
      assert.equal(await status(repo.repoRoot, repo.cli), '');

      const [entry] = await svc.list(repo.repoRoot);
      assert.equal(entry.selector, 'stash@{0}');
      assert.match(entry.message, /wip/);

      await svc.apply(repo.repoRoot, 'stash@{0}', true);
      const porcelain = await status(repo.repoRoot, repo.cli);
      assert.match(porcelain, /^MM notes\.txt$/m);
      assert.match(readFileSync(file, 'utf8'), /unstaged/);
    } finally {
      repo.cleanup();
    }
  });

  it('leaves newly created files in place unless the stash includes them', async () => {
    const repo = initTempRepository();
    try {
      const tracked = join(repo.repoRoot, 'tracked.txt');
      writeFileSync(tracked, 'base\n');
      runGit(repo.repoRoot, ['add', 'tracked.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'base']);
      writeFileSync(tracked, 'base\nedit\n');
      writeFileSync(join(repo.repoRoot, 'new.txt'), 'new\n');

      const svc = new StashService(mockCliRegistry(repo.repoRoot, repo.cli));
      await svc.create(repo.repoRoot, { mode: 'all', message: 'keep-new', includeUntracked: false });
      const kept = await status(repo.repoRoot, repo.cli);
      assert.match(kept, /new\.txt/);
      assert.doesNotMatch(kept, /tracked\.txt/);
      assert.match((await svc.list(repo.repoRoot))[0].message, /keep-new/);

      await svc.create(repo.repoRoot, { mode: 'all', message: 'take-new', includeUntracked: true });
      assert.equal(await status(repo.repoRoot, repo.cli), '');
      assert.match((await svc.list(repo.repoRoot))[0].message, /take-new/);
    } finally {
      repo.cleanup();
    }
  });

  it('stashes one path and leaves the other file in place', async () => {
    const repo = initTempRepository();
    try {
      writeFileSync(join(repo.repoRoot, 'keep.txt'), 'base\n');
      writeFileSync(join(repo.repoRoot, 'take.txt'), 'base\n');
      runGit(repo.repoRoot, ['add', 'keep.txt', 'take.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'base']);
      writeFileSync(join(repo.repoRoot, 'keep.txt'), 'base\nstay\n');
      writeFileSync(join(repo.repoRoot, 'take.txt'), 'base\ngo\n');

      const svc = new StashService(mockCliRegistry(repo.repoRoot, repo.cli));
      await svc.create(repo.repoRoot, { mode: 'paths', message: 'take', paths: ['take.txt'] });
      const porcelain = await status(repo.repoRoot, repo.cli);
      assert.match(porcelain, /keep\.txt/);
      assert.doesNotMatch(porcelain, /take\.txt/);

      await svc.pop(repo.repoRoot, 'stash@{0}');
      assert.match(readFileSync(join(repo.repoRoot, 'take.txt'), 'utf8'), /go/);
      assert.equal((await svc.list(repo.repoRoot)).length, 0);
    } finally {
      repo.cleanup();
    }
  });

  it('stashes one hunk and applies it back beside the remaining hunk', async () => {
    const repo = initTempRepository();
    try {
      const file = join(repo.repoRoot, 'h.txt');
      writeFileSync(file, Array.from({ length: 20 }, (_, i) => String(i + 1)).join('\n') + '\n');
      writeFileSync(join(repo.repoRoot, 'other.txt'), 'base\n');
      runGit(repo.repoRoot, ['add', 'h.txt', 'other.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'base']);

      const lines = Array.from({ length: 20 }, (_, i) => String(i + 1));
      lines[1] = 'HUNK';
      lines[15] = 'KEEP';
      writeFileSync(file, lines.join('\n') + '\n');
      writeFileSync(join(repo.repoRoot, 'other.txt'), 'base\nstay\n');

      const patches = new PatchStagingService(
        mockGitExtensionService([mockRepository(repo.repoRoot)]),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );
      const diff = await patches.loadFileDiff(repo.repoRoot, 'h.txt', 'unstaged');
      assert.equal(diff.hunks.length, 2);
      const patch = await patches.selectionPatch(repo.repoRoot, {
        op: 'stashHunk',
        path: 'h.txt',
        hunkId: '0',
        side: 'unstaged',
      });

      const svc = new StashService(mockCliRegistry(repo.repoRoot, repo.cli));
      await svc.create(repo.repoRoot, { mode: 'patch', message: 'hunk', patch, side: 'unstaged' });
      const text = readFileSync(file, 'utf8');
      assert.doesNotMatch(text, /HUNK/);
      assert.match(text, /KEEP/);
      assert.match(await status(repo.repoRoot, repo.cli), /other\.txt/);

      await svc.apply(repo.repoRoot, 'stash@{0}', true);
      const restored = readFileSync(file, 'utf8');
      assert.match(restored, /HUNK/);
      assert.match(restored, /KEEP/);
      assert.match(await status(repo.repoRoot, repo.cli), /other\.txt/);
    } finally {
      repo.cleanup();
    }
  });

  it('restores a staged hunk as staged while other edits stay put', async () => {
    const repo = initTempRepository();
    try {
      const file = join(repo.repoRoot, 's.txt');
      writeFileSync(file, 'base\n');
      writeFileSync(join(repo.repoRoot, 'other.txt'), 'base\n');
      runGit(repo.repoRoot, ['add', 's.txt', 'other.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'base']);
      writeFileSync(file, 'base\nstaged\n');
      runGit(repo.repoRoot, ['add', 's.txt']);
      writeFileSync(join(repo.repoRoot, 'other.txt'), 'base\nstay\n');

      const patches = new PatchStagingService(
        mockGitExtensionService([mockRepository(repo.repoRoot)]),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );
      const patch = await patches.selectionPatch(repo.repoRoot, {
        op: 'stashHunk',
        path: 's.txt',
        hunkId: '0',
        side: 'staged',
      });
      const svc = new StashService(mockCliRegistry(repo.repoRoot, repo.cli));
      await svc.create(repo.repoRoot, { mode: 'patch', message: 'staged hunk', patch, side: 'staged' });

      assert.equal(readFileSync(file, 'utf8'), 'base\n');
      const stashed = await status(repo.repoRoot, repo.cli);
      assert.match(stashed, /other\.txt/);
      assert.doesNotMatch(stashed, /s\.txt/);

      await svc.apply(repo.repoRoot, 'stash@{0}', true);
      const porcelain = await status(repo.repoRoot, repo.cli);
      assert.match(porcelain, /^M  s\.txt$/m);
      assert.match(porcelain, /other\.txt/);
    } finally {
      repo.cleanup();
    }
  });

  it('drops every selected stash, highest index first', async () => {
    const repo = initTempRepository();
    try {
      const file = join(repo.repoRoot, 'n.txt');
      writeFileSync(file, 'base\n');
      runGit(repo.repoRoot, ['add', 'n.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'base']);
      const svc = new StashService(mockCliRegistry(repo.repoRoot, repo.cli));
      writeFileSync(file, 'one\n');
      await svc.create(repo.repoRoot, { mode: 'all', message: 'older', includeUntracked: false });
      writeFileSync(file, 'two\n');
      await svc.create(repo.repoRoot, { mode: 'all', message: 'newer', includeUntracked: false });
      assert.equal((await svc.list(repo.repoRoot)).length, 2);
      await svc.drop(repo.repoRoot, ['stash@{0}', 'stash@{1}']);
      assert.equal((await svc.list(repo.repoRoot)).length, 0);
    } finally {
      repo.cleanup();
    }
  });
});
