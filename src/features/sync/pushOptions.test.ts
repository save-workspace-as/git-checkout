import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  initialPushChoices,
  loadPushCatalog,
  orderedBranchNames,
  parsePushCommandArg,
  pushCliArgs,
  type PushCatalog,
} from './pushOptions';

const catalog: PushCatalog = {
  remotes: ['upstream', 'origin'],
  localBranches: ['agent/feature', 'main'],
  headName: 'agent/feature',
  upstreamRemote: 'origin',
  upstreamBranch: 'main',
};

describe('push options', () => {
  it('builds push args for the remote, branch, tags, and force-with-lease', () => {
    assert.deepEqual(
      pushCliArgs({
        remoteName: 'origin',
        branchName: 'main',
        setUpstream: true,
        forceWithLease: true,
        skipHooks: true,
        tags: true,
      }),
      ['push', '--no-verify', '-u', '--force-with-lease', '--tags', '--', 'origin', 'main'],
    );
    assert.deepEqual(pushCliArgs({ branchName: 'main', forceWithLease: true }), [
      'push',
      '--force-with-lease',
    ]);
    assert.throws(() => pushCliArgs({ remoteName: '--force', branchName: 'main' }));
    assert.throws(() => pushCliArgs({ remoteName: 'origin', branchName: 'a..b' }));
  });

  it('defaults to the upstream remote and the checked-out branch', () => {
    assert.deepEqual(initialPushChoices(catalog), {
      remote: 'origin',
      branch: 'agent/feature',
      tags: false,
      force: false,
    });
  });

  it('prefers origin when the branch has no upstream', () => {
    assert.equal(
      initialPushChoices({ ...catalog, upstreamRemote: null, upstreamBranch: null }).remote,
      'origin',
    );
  });

  it('lists the current branch before the other local branches', () => {
    assert.deepEqual(orderedBranchNames(catalog, 'agent/feature'), ['agent/feature', 'main']);
    assert.deepEqual(orderedBranchNames(catalog, 'topic'), ['topic', 'agent/feature', 'main']);
  });

  it('parses a command argument and ignores unrelated values', () => {
    assert.deepEqual(
      parsePushCommandArg({ remote: ' origin ', branch: 'main', tags: true, force: false }),
      { remote: 'origin', branch: 'main', tags: true, force: false },
    );
    assert.equal(parsePushCommandArg({ label: 'main' }), undefined);
    assert.equal(parsePushCommandArg({ remote: '--force', branch: 'main' }), undefined);
    assert.equal(parsePushCommandArg(null), undefined);
  });

  it('loads remotes and local branches', async () => {
    const loaded = await loadPushCatalog(
      {
        execRead: async (args) => {
          if (args[0] === 'remote') {
            return { stdout: 'origin\nupstream\n' };
          }
          if (args[0] === 'for-each-ref') {
            return { stdout: 'main\nagent/feature\n' };
          }
          return { stdout: '' };
        },
      },
      'agent/feature',
      'origin/main',
    );
    assert.deepEqual(loaded.remotes, ['origin', 'upstream']);
    assert.deepEqual(loaded.localBranches, ['agent/feature', 'main']);
    assert.equal(loaded.headName, 'agent/feature');
    assert.equal(loaded.upstreamRemote, 'origin');
    assert.equal(loaded.upstreamBranch, 'main');
  });
});
