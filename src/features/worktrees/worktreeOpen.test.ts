import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { planWorktreeOpen } from './worktreeOpen';

describe('planWorktreeOpen', () => {
  it('reuses the current window when the worktree is already a workspace folder', () => {
    assert.deepEqual(planWorktreeOpen('/repos/main/', ['/repos/main']), { action: 'reveal' });
  });

  it('asks before opening a different folder', () => {
    assert.deepEqual(planWorktreeOpen('/repos/feature', ['/repos/main']), {
      action: 'prompt',
      path: '/repos/feature',
    });
  });
});
