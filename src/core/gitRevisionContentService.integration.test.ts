import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { initTempRepository, runGit } from './testing/gitRepoHarness';
import { GitRevisionContentService } from './gitRevisionContentService';
import { mockCliRegistry, mockGitExtensionService, mockRepository } from './testing/serviceTestUtils';

describe('GitRevisionContentService', () => {
  it('reads file content at HEAD via git show', async () => {
    const repo = initTempRepository();
    try {
      const file = join(repo.repoRoot, 'tracked.txt');
      writeFileSync(file, 'hello revision\n');
      runGit(repo.repoRoot, ['add', 'tracked.txt']);
      runGit(repo.repoRoot, ['commit', '-m', 'add-file']);
      const mockRepo = mockRepository(repo.repoRoot);
      const svc = new GitRevisionContentService(
        mockGitExtensionService([mockRepo]),
        mockCliRegistry(repo.repoRoot, repo.cli),
      );
      const text = await svc.readFileAtRevision(repo.repoRoot, 'HEAD', 'tracked.txt');
      assert.match(text, /hello revision/);
    } finally {
      repo.cleanup();
    }
  });
});
