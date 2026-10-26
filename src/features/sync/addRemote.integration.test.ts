import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { executeAddRemote, testRemoteUrl } from './addRemote';
import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';

describe('add remote integration', () => {
  it('tests a local repository and then adds it as a remote', async () => {
    const upstream = initTempRepository();
    const work = initTempRepository();
    try {
      runGit(upstream.repoRoot, ['commit', '--allow-empty', '-m', 'init']);

      assert.equal(await testRemoteUrl(work.cli, upstream.repoRoot), undefined);
      await executeAddRemote(work.cli, { name: 'contrib', url: upstream.repoRoot });

      const url = (await work.cli.execRead(['remote', 'get-url', 'contrib'])).stdout.trim();
      assert.equal(url, upstream.repoRoot);
      assert.equal(
        await testRemoteUrl(work.cli, join(upstream.repoRoot, 'missing')),
        'The remote repository was not found',
      );
      await assert.rejects(
        () => executeAddRemote(work.cli, { name: 'contrib', url: upstream.repoRoot }),
        /Remote already exists/,
      );
    } finally {
      upstream.cleanup();
      work.cleanup();
    }
  });
});
