import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { IDLE_REPO_OPERATION, type RepoOperationDto } from './historyProtocol';
import { describeOperation } from './operationBanner';

const op = (patch: Partial<RepoOperationDto>): RepoOperationDto => ({
  active: true, kind: 'rebase', conflicted: true, summary: 'Rebase in progress', ...patch,
});

describe('describeOperation', () => {
  it('shows nothing when no operation is running', () => {
    assert.equal(describeOperation(IDLE_REPO_OPERATION), undefined);
  });

  it('describes a rebase that stopped on a conflict', () => {
    const banner = describeOperation(op({
      conflictCount: 1, branch: 'main', target: '7abd451', commit: 'b627fbf', progress: { step: 5, total: 7 },
    }));
    assert.equal(banner?.title, "Rebasing 'main' → '7abd451' (rebased 4/7 commits)");
    assert.equal(banner?.message, "Fix 1 conflict with 'b627fbf' and then continue.");
    assert.equal(banner?.progress, 4 / 7);
    assert.equal(banner?.primary, 'resolve');
    assert.equal(banner?.canAbort, true);
  });

  it('counts the stopped commit as rebased once its conflicts are gone', () => {
    const banner = describeOperation(op({
      conflicted: false, conflictCount: 0, branch: 'main', target: '7abd451', progress: { step: 5, total: 7 },
    }));
    assert.equal(banner?.title, "Rebasing 'main' → '7abd451' (rebased 5/7 commits)");
    assert.equal(banner?.message, 'All conflicts are resolved. Continue to finish.');
    assert.equal(banner?.primary, 'continue');
  });

  it('words the number of conflicts', () => {
    assert.equal(describeOperation(op({ kind: 'merge', conflictCount: 3 }))?.message, 'Fix 3 conflicts and then continue.');
    assert.equal(describeOperation(op({ kind: 'merge', conflictCount: 1 }))?.message, 'Fix 1 conflict and then continue.');
    assert.equal(describeOperation(op({ kind: 'merge' }))?.message, 'Fix the conflicts and then continue.');
  });

  it('names what a merge, cherry-pick or revert brings in', () => {
    assert.equal(describeOperation(op({ kind: 'merge', target: 'aaaaaaa' }))?.title, "Merging 'aaaaaaa'");
    assert.equal(describeOperation(op({ kind: 'cherry-pick', target: 'bbbbbbb' }))?.title, "Cherry-picking 'bbbbbbb'");
    assert.equal(describeOperation(op({ kind: 'revert', target: 'ccccccc' }))?.title, "Reverting 'ccccccc'");
    assert.equal(describeOperation(op({ kind: 'merge' }))?.title, 'Merging');
  });

  it('has no progress bar without progress, and no actions for a bisect', () => {
    assert.equal(describeOperation(op({ kind: 'merge' }))?.progress, undefined);
    const bisect = describeOperation(op({ kind: 'bisect', conflicted: false, summary: 'Bisect in progress' }));
    assert.equal(bisect?.title, 'Bisect in progress');
    assert.equal(bisect?.primary, null);
    assert.equal(bisect?.canAbort, false);
  });

  it('does not let progress go below zero', () => {
    assert.equal(describeOperation(op({ progress: { step: 1, total: 3 } }))?.progress, 0);
  });
});
