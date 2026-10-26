import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import { describe, it } from 'node:test';

import { GitFlowService } from './gitFlowService';
import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry } from '../../core/testing/serviceTestUtils';

function gitOutput(repoRoot: string, args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
}

describe('GitFlowService integration', () => {
  it('does not create a branch when git-flow is missing', async () => {
    const repo = initTempRepository();
    try {
      runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
      const service = new GitFlowService(mockCliRegistry(repo.repoRoot, repo.cli));
      const result = await service.run(repo.repoRoot, {
        action: 'start',
        kind: 'feature',
        name: 'widget',
      });
      const branches = gitOutput(repo.repoRoot, ['branch', '--list']);
      if (!result.available) {
        assert.equal(result.ran, false);
        assert.match(result.message, /not installed/);
        assert.ok(result.commands.some((line) => line.includes('feature/widget')));
        assert.doesNotMatch(branches, /feature\/widget/);
        return;
      }
      assert.equal(result.ran, true);
      assert.match(branches, /feature\/widget/);
    } finally {
      repo.cleanup();
    }
  });

  describe('init', () => {
    const layout = {
      production: 'main',
      develop: 'develop',
      featurePrefix: 'feature/',
      releasePrefix: 'release/',
      hotfixPrefix: 'hotfix/',
      versionTagPrefix: 'v',
    };

    it('creates develop from production, records the layout, and switches to develop', async () => {
      const repo = initTempRepository();
      try {
        runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
        const service = new GitFlowService(mockCliRegistry(repo.repoRoot, repo.cli));
        assert.equal((await service.readInitState(repo.repoRoot)).initialized, false);

        const result = await service.initialize(repo.repoRoot, layout);
        assert.equal(result.ran, true);
        assert.equal(gitOutput(repo.repoRoot, ['branch', '--show-current']).trim(), 'develop');
        assert.equal(
          gitOutput(repo.repoRoot, ['rev-parse', 'develop']),
          gitOutput(repo.repoRoot, ['rev-parse', 'main']),
        );
        const config = gitOutput(repo.repoRoot, ['config', '--get-regexp', '^gitflow\\.']);
        for (const line of [
          'gitflow.branch.master main',
          'gitflow.branch.develop develop',
          'gitflow.prefix.feature feature/',
          'gitflow.prefix.release release/',
          'gitflow.prefix.hotfix hotfix/',
          'gitflow.prefix.versiontag v',
        ]) {
          assert.ok(config.includes(line), line);
        }
        const state = await service.readInitState(repo.repoRoot);
        assert.equal(state.initialized, true);
        assert.equal(state.defaults.versionTagPrefix, 'v');
      } finally {
        repo.cleanup();
      }
    });

    it('keeps an existing development branch and its commits', async () => {
      const repo = initTempRepository();
      try {
        runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
        runGit(repo.repoRoot, ['checkout', '-b', 'dev']);
        runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'ahead']);
        const ahead = gitOutput(repo.repoRoot, ['rev-parse', 'dev']);
        runGit(repo.repoRoot, ['checkout', 'main']);
        await new GitFlowService(mockCliRegistry(repo.repoRoot, repo.cli)).initialize(repo.repoRoot, {
          ...layout,
          develop: 'dev',
        });
        assert.equal(gitOutput(repo.repoRoot, ['rev-parse', 'dev']), ahead);
        assert.equal(gitOutput(repo.repoRoot, ['branch', '--show-current']).trim(), 'dev');
      } finally {
        repo.cleanup();
      }
    });

    it('initializes a repository whose production branch is master', async () => {
      const repo = initTempRepository();
      try {
        runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
        runGit(repo.repoRoot, ['branch', '-m', 'master']);
        const service = new GitFlowService(mockCliRegistry(repo.repoRoot, repo.cli));
        const state = await service.readInitState(repo.repoRoot);
        assert.equal(state.defaults.production, 'master');
        await service.run(repo.repoRoot, { action: 'init' });
        assert.equal(gitOutput(repo.repoRoot, ['config', '--get', 'gitflow.branch.master']).trim(), 'master');
        assert.equal(gitOutput(repo.repoRoot, ['branch', '--show-current']).trim(), 'develop');
      } finally {
        repo.cleanup();
      }
    });

    it('changes nothing when the production branch does not exist', async () => {
      const repo = initTempRepository();
      try {
        runGit(repo.repoRoot, ['commit', '--allow-empty', '-m', 'init']);
        await assert.rejects(
          new GitFlowService(mockCliRegistry(repo.repoRoot, repo.cli)).initialize(repo.repoRoot, {
            ...layout,
            production: 'trunk',
          }),
          /does not exist/,
        );
        assert.equal(gitOutput(repo.repoRoot, ['branch', '--list', 'develop']).trim(), '');
        assert.equal(gitOutput(repo.repoRoot, ['branch', '--show-current']).trim(), 'main');
      } finally {
        repo.cleanup();
      }
    });
  });
});
