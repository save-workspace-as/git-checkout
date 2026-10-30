import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { PatchStagingService } from './patchStagingService';
import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry, mockGitExtensionService, mockRepository } from '../../core/testing/serviceTestUtils';

describe('non-text working copy diffs', () => {
  it('classifies a small PNG as an image diff', async () => {
    const repo = initTempRepository();
    try {
      const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
      writeFileSync(join(repo.repoRoot, 'icon.png'), png);
      runGit(repo.repoRoot, ['add', 'icon.png']);
      runGit(repo.repoRoot, ['commit', '-m', 'add-png']);

      const changed = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x02]);
      writeFileSync(join(repo.repoRoot, 'icon.png'), changed);

      const svc = new PatchStagingService(
        mockGitExtensionService([mockRepository(repo.repoRoot)]),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );
      const diff = await svc.loadFileDiff(repo.repoRoot, 'icon.png', 'unstaged');
      assert.equal(diff.nonTextKind, 'image');
      assert.ok(diff.blobs && diff.blobs.length === 2);
      assert.ok(diff.blobs[0].inline);
    } finally {
      repo.cleanup();
    }
  });

  it('shows an untracked picture as an image with nothing on the old side, and leaves an untracked text file alone', async () => {
    const repo = initTempRepository();
    try {
      const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300 * 1024, 7)]);
      writeFileSync(join(repo.repoRoot, 'new.png'), png);
      writeFileSync(join(repo.repoRoot, 'notes.txt'), 'plain text\n');
      const svc = new PatchStagingService(
        mockGitExtensionService([mockRepository(repo.repoRoot)]),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );
      const diff = await svc.loadUntrackedFileDiff(repo.repoRoot, 'new.png');
      assert.equal(diff?.nonTextKind, 'image');
      assert.deepEqual(diff?.blobs?.map((blob) => [blob.side, blob.byteLength]), [['old', 0], ['new', png.length]]);
      assert.equal(diff?.blobs?.[1].inline?.complete, true, 'a picture bigger than a slice is sent whole');
      assert.equal(await svc.loadUntrackedFileDiff(repo.repoRoot, 'notes.txt'), undefined);
    } finally {
      repo.cleanup();
    }
  });

  it('detects LFS pointer changes', async () => {
    const repo = initTempRepository();
    try {
      const pointerA = `version https://git-lfs.github.com/spec/v1
oid sha256:4d7a214614ab2935c943f9a15698f1323bddb093b995844a6503eaf3bbb788f2
size 100
`;
      const pointerB = pointerA.replace('size 100', 'size 200');
      writeFileSync(join(repo.repoRoot, 'big.bin'), pointerA);
      runGit(repo.repoRoot, ['add', 'big.bin']);
      runGit(repo.repoRoot, ['commit', '-m', 'lfs']);

      writeFileSync(join(repo.repoRoot, 'big.bin'), pointerB);
      const svc = new PatchStagingService(
        mockGitExtensionService([mockRepository(repo.repoRoot)]),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );
      const diff = await svc.loadFileDiff(repo.repoRoot, 'big.bin', 'unstaged');
      assert.equal(diff.nonTextKind, 'lfs');
      assert.ok(diff.lfsComparison?.old);
      assert.ok(diff.lfsComparison?.new);
      assert.notEqual(diff.lfsComparison?.old?.size, diff.lfsComparison?.new?.size);
    } finally {
      repo.cleanup();
    }
  });
});
