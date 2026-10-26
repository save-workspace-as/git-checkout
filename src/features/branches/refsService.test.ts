import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { CommitGraphService } from '../graph/commitGraphService';
import { RefsService } from './refsService';
import {
  mockCliRegistry,
  mockGitCli,
  mockGitExtensionService,
  mockRepository,
} from '../../core/testing/serviceTestUtils';

const REPO = '/repo';

function mockGraphService(): CommitGraphService {
  return {
    resolveHeadRef: () => 'main',
    getFilterRef: () => 'main',
  } as unknown as CommitGraphService;
}

describe('RefsService.loadSnapshot', () => {
  it('runs for-each-ref commands and parses snapshot fields', async () => {
    const branchRecord = ['main', 'abc', 'origin/main', '', '*'].join('\0');
    const remoteRecord = ['origin/main', 'abc'].join('\0');
    const tagRecord = ['v1', 'abc', 'tag'].join('\0');

    const { cli, reads } = mockGitCli({
      execRead: async (args) => {
        if (args[0] === 'for-each-ref' && args.includes('refs/heads/')) {
          return { stdout: `${branchRecord}\n` };
        }
        if (args[0] === 'for-each-ref' && args.includes('refs/remotes/')) {
          return { stdout: `${remoteRecord}\n` };
        }
        if (args[0] === 'for-each-ref' && args.includes('refs/tags/')) {
          return { stdout: `${tagRecord}\n` };
        }
        if (args[0] === 'remote' && args[1] === 'get-url') {
          return { stdout: 'https://example.com/repo.git\n' };
        }
        if (args[0] === 'remote') {
          return { stdout: 'origin\n' };
        }
        throw new Error(`unexpected: ${args.join(' ')}`);
      },
    });

    const repo = mockRepository(REPO);
    const svc = new RefsService(
      mockGitExtensionService([repo]),
      mockCliRegistry(REPO, cli),
      mockGraphService(),
    );

    const snapshot = await svc.loadSnapshot(REPO);
    assert.equal(snapshot.headRef, 'main');
    assert.equal(snapshot.filterRef, 'main');
    assert.equal(snapshot.branches.length, 1);
    assert.equal(snapshot.branches[0].name, 'main');
    assert.equal(snapshot.remoteBranches[0].name, 'origin/main');
    assert.equal(snapshot.remoteBranches[0].remote, 'origin');
    assert.equal(snapshot.tags[0].name, 'v1');
    assert.ok(reads.some((args) => args[0] === 'for-each-ref' && args.includes('refs/heads/')));
  });
});

describe('RefsService.compareBranches', () => {
  it('builds rev-list, log, and diff commands for the compare range', async () => {
    const { cli, reads } = mockGitCli({
      execRead: async (args) => {
        if (args[0] === 'rev-list') {
          return { stdout: '2\t5\n' };
        }
        if (args[0] === 'log') {
          return { stdout: 'abc subject\n' };
        }
        if (args[0] === 'diff') {
          return { stdout: ' 1 file changed\n' };
        }
        throw new Error(`unexpected: ${args.join(' ')}`);
      },
    });

    const svc = new RefsService(
      mockGitExtensionService([mockRepository(REPO)]),
      mockCliRegistry(REPO, cli),
      mockGraphService(),
    );

    const result = await svc.compareBranches(REPO, 'main', 'feature');
    assert.equal(result.base, 'main');
    assert.equal(result.compare, 'feature');
    assert.equal(result.leftCount, 2);
    assert.equal(result.rightCount, 5);
    assert.match(result.logPreview, /abc subject/);
    assert.deepEqual(
      reads.find((args) => args[0] === 'rev-list')?.slice(-1),
      ['main...feature'],
    );
  });
});
