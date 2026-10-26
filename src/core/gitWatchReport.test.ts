import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { formatWatchVerifyReport } from './gitWatchReport';
import type { RepositoryWatchSnapshot } from './gitRepositoryWatcher';

describe('formatWatchVerifyReport', () => {
  it('reports when no watchers are active', () => {
    const text = formatWatchVerifyReport([]);
    assert.match(text, /no active repository watchers/);
  });

  it('includes layout and last refresh details', () => {
    const snap: RepositoryWatchSnapshot = {
      repoRoot: '/repo',
      layout: {
        repoRoot: '/repo',
        gitDir: '/repo/.git',
        commonDir: '/repo/.git',
        headPath: '/repo/.git/HEAD',
        indexPath: '/repo/.git/index',
        packedRefsPath: '/repo/.git/packed-refs',
        refsDir: '/repo/.git/refs',
        reftableDir: null,
        worktreesDir: '/repo/.git/worktrees',
        modulesDir: '/repo/.git/modules',
        configPath: '/repo/.git/config',
      },
      watchersActive: true,
      lastRefreshAt: 1_700_000_000_000,
      lastRefreshReason: 'layout',
      lastHeadShort: 'abc1234',
    };

    const text = formatWatchVerifyReport([snap]);
    assert.match(text, /repo: \/repo/);
    assert.match(text, /watchersActive: true/);
    assert.match(text, /HEAD=abc1234/);
    assert.doesNotMatch(text, /layout: unresolved/);
  });
});
