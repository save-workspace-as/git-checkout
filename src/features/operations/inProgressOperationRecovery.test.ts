import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { IDLE_REPO_OPERATION, type RepoOperationDto } from '../../shared/history/historyProtocol';
import { planInProgressRecovery } from './inProgressOperationRecovery';

const stopped = (kind: RepoOperationDto['kind']): RepoOperationDto => ({
  active: true, kind, conflicted: false, summary: 'in progress',
});

describe('planInProgressRecovery', () => {
  it('restores the bisect session from the sequencer files', () => {
    assert.deepEqual(planInProgressRecovery(stopped('bisect')), { restoreBisect: true });
  });

  it('leaves a stopped merge, rebase, cherry-pick or revert to the banner', () => {
    for (const kind of ['merge', 'rebase', 'cherry-pick', 'revert'] as const) {
      assert.deepEqual(planInProgressRecovery(stopped(kind)), { restoreBisect: false });
    }
  });

  it('does nothing when idle', () => {
    assert.deepEqual(planInProgressRecovery(IDLE_REPO_OPERATION), { restoreBisect: false });
  });
});
