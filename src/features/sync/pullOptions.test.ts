import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  initialPullChoices,
  isSafeGitToken,
  loadPullCatalog,
  parsePullCommandArg,
  pullChoicesForRemote,
  pullCliArgs,
  pullIntoArgs,
  rebaseFromPullConfig,
  splitUpstream,
  type PullCatalog,
} from './pullOptions';

const catalog: PullCatalog = {
  remotes: ['origin', 'upstream'],
  localBranches: ['feature/one', 'main'],
  branchesByRemote: {
    origin: ['feature/one', 'main'],
    upstream: ['main'],
  },
  headName: 'feature/one',
  upstreamRemote: 'origin',
  upstreamBranch: 'main',
  rebaseByDefault: false,
};

describe('pull options', () => {
  it('splits an upstream into remote and branch', () => {
    assert.deepEqual(splitUpstream('origin/feature/one'), {
      remote: 'origin',
      branch: 'feature/one',
    });
    assert.deepEqual(splitUpstream(null), { remote: null, branch: null });
  });

  it('treats pull.rebase values that rebase as enabled', () => {
    assert.equal(rebaseFromPullConfig('true'), true);
    assert.equal(rebaseFromPullConfig('merges'), true);
    assert.equal(rebaseFromPullConfig('false'), false);
    assert.equal(rebaseFromPullConfig(''), false);
    assert.equal(rebaseFromPullConfig(undefined), false);
  });

  it('rejects option-like and revision-syntax tokens', () => {
    assert.equal(isSafeGitToken('feature/one'), true);
    assert.equal(isSafeGitToken('-u'), false);
    assert.equal(isSafeGitToken('a..b'), false);
    assert.equal(isSafeGitToken('HEAD@{1}'), false);
    assert.equal(isSafeGitToken('has space'), false);
  });

  it('builds pull args from the chosen remote, branch, and rebase flag', () => {
    assert.deepEqual(pullCliArgs({ remote: 'origin', branch: 'main', rebase: false }), [
      'pull',
      '--no-rebase',
      '--',
      'origin',
      'main',
    ]);
    assert.deepEqual(pullCliArgs({ remote: 'upstream', branch: 'feature/one', rebase: true }), [
      'pull',
      '--rebase',
      '--',
      'upstream',
      'feature/one',
    ]);
    assert.throws(() => pullCliArgs({ remote: '--force', branch: 'main', rebase: false }));
  });

  it('defaults to the upstream remote and branch', () => {
    assert.deepEqual(initialPullChoices(catalog, true), {
      remote: 'origin',
      branch: 'main',
      rebase: false,
      stash: true,
    });
  });

  it('keeps the branch when the new remote has it', () => {
    const next = pullChoicesForRemote(
      { remote: 'origin', branch: 'main', rebase: true, stash: false },
      catalog,
      'upstream',
    );
    assert.equal(next.remote, 'upstream');
    assert.equal(next.branch, 'main');
    assert.equal(next.rebase, true);
  });

  it('falls back to the remote default branch when the previous name is absent', () => {
    const next = pullChoicesForRemote(
      { remote: 'origin', branch: 'feature/one', rebase: false, stash: false },
      catalog,
      'upstream',
    );
    assert.equal(next.branch, 'main');
  });

  it('parses a command argument and ignores unrelated values', () => {
    assert.deepEqual(
      parsePullCommandArg({ remote: ' origin ', branch: 'main', rebase: true, stash: false }),
      { remote: 'origin', branch: 'main', rebase: true, stash: false },
    );
    assert.equal(parsePullCommandArg({ label: 'main' }), undefined);
    assert.equal(parsePullCommandArg({ remote: '--force', branch: 'main' }), undefined);
    assert.equal(parsePullCommandArg(null), undefined);
  });

  it('loads remotes, remote branches, and pull.rebase', async () => {
    const loaded = await loadPullCatalog(
      {
        execRead: async (args) => {
          if (args[0] === 'remote') {
            return { stdout: 'origin\nupstream\n' };
          }
          if (args[0] === 'for-each-ref') {
            return { stdout: 'origin/HEAD\norigin/main\norigin/feature/one\nupstream/main\n' };
          }
          if (args[0] === 'config') {
            return { stdout: 'true\n' };
          }
          return { stdout: '' };
        },
      },
      'feature/one',
      'origin/main',
    );
    assert.deepEqual(loaded.remotes, ['origin', 'upstream']);
    assert.deepEqual(loaded.branchesByRemote.origin, ['feature/one', 'main']);
    assert.equal(loaded.rebaseByDefault, true);
    assert.equal(loaded.upstreamBranch, 'main');
  });

  it('lists the local branches a pull can go into', async () => {
    const loaded = await loadPullCatalog(
      {
        execRead: async (args) =>
          args[0] === 'for-each-ref' && args.includes('refs/heads/')
            ? { stdout: 'main\nfeature/one\n' }
            : { stdout: '' },
      },
      'main',
      null,
    );
    assert.deepEqual(loaded.localBranches, ['main', 'feature/one']);
  });

  it('builds a fast-forward fetch into another local branch, and rejects names that Git would read as options', () => {
    assert.deepEqual(pullIntoArgs({ remote: 'origin', branch: 'main', into: 'other' }), [
      'fetch', '--', 'origin', 'refs/heads/main:refs/heads/other',
    ]);
    assert.throws(() => pullIntoArgs({ remote: 'origin', branch: 'main', into: '--force' }), /local branch/);
    assert.throws(() => pullIntoArgs({ remote: '-x', branch: 'main', into: 'other' }), /remote/);
  });

  it('leaves rebase off when pull.rebase is unset', async () => {
    const loaded = await loadPullCatalog(
      {
        execRead: async (args) => {
          if (args[0] === 'config') {
            throw new Error('exit 1');
          }
          return { stdout: '' };
        },
      },
      'main',
      null,
    );
    assert.equal(loaded.rebaseByDefault, false);
    assert.deepEqual(loaded.remotes, []);
  });
});
