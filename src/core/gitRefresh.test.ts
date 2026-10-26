import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { coalescePendingRefreshReason } from './gitRefresh';

describe('coalescePendingRefreshReason', () => {
  it('keeps filesystem once scheduled', () => {
    assert.equal(coalescePendingRefreshReason('vscodeGitState', 'filesystem'), 'filesystem');
    assert.equal(coalescePendingRefreshReason('filesystem', 'layout'), 'filesystem');
  });

  it('replaces non-filesystem reasons with the latest incoming reason', () => {
    assert.equal(coalescePendingRefreshReason('layout', 'manual'), 'manual');
    assert.equal(coalescePendingRefreshReason('vscodeGitState', 'layout'), 'layout');
  });
});
