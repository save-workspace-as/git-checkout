import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { planSubmoduleOpen, resolveActiveRepoRoot } from './submoduleOpen';

describe('planSubmoduleOpen', () => {
  it('keeps a submodule under the workspace in this window', () => {
    assert.deepEqual(planSubmoduleOpen('/repos/main/libs/mid', ['/repos/main']), {
      action: 'inner',
      path: '/repos/main/libs/mid',
    });
  });

  it('stays in this window when the submodule is already a workspace folder', () => {
    assert.deepEqual(planSubmoduleOpen('/repos/main/libs/mid/', ['/repos/main/libs/mid']), {
      action: 'inner',
      path: '/repos/main/libs/mid/',
    });
  });

  it('opens a path outside the workspace with Open Folder', () => {
    assert.deepEqual(planSubmoduleOpen('/other/lib', ['/repos/main']), {
      action: 'openFolder',
      path: '/other/lib',
    });
  });
});

describe('resolveActiveRepoRoot', () => {
  it('prefers the opened submodule when that repository is loaded', () => {
    assert.equal(
      resolveActiveRepoRoot(['/repos/main', '/repos/main/libs/mid'], '/repos/main/libs/mid'),
      '/repos/main/libs/mid',
    );
  });

  it('falls back to the first repository until the submodule is open', () => {
    assert.equal(resolveActiveRepoRoot(['/repos/main'], '/repos/main/libs/mid'), '/repos/main');
    assert.equal(resolveActiveRepoRoot([], null), null);
  });
});
