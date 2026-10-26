import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { commitFileTarget, openRevision, resetSources } from './commitFileActions';
import { commitTreePathContext } from './pathHistoryProtocol';

describe('commitFileTarget', () => {
  it('reads a Tree tab file and defaults the list', () => {
    assert.deepEqual(commitFileTarget(commitTreePathContext('src/a.ts', 'blob', 'abc')), {
      path: 'src/a.ts', revision: 'abc', list: 'tree',
    });
  });

  it('reads a Changes tab change with its comparison, rename and status', () => {
    const context = commitTreePathContext('src/new.ts', 'blob', 'head', {
      list: 'changes', baseRevision: 'base', oldPath: 'src/old.ts', status: 'R100',
    });
    assert.deepEqual(commitFileTarget(context), {
      path: 'src/new.ts', revision: 'head', baseRevision: 'base', oldPath: 'src/old.ts', status: 'R100', list: 'changes',
    });
  });

  it('rejects folders, missing revisions and other values', () => {
    assert.equal(commitFileTarget(commitTreePathContext('src', 'tree', 'abc')), null);
    assert.equal(commitFileTarget(commitTreePathContext('a.ts', 'blob')), null);
    assert.equal(commitFileTarget({ path: 'a.ts' }), null);
    assert.equal(commitFileTarget(undefined), null);
  });
});

describe('resetSources', () => {
  it('uses the commit and its first parent', () => {
    assert.deepEqual(resetSources({ path: 'a.ts', revision: 'abc', list: 'tree' }), {
      atCommit: { revision: 'abc', path: 'a.ts' },
      beforeCommit: { revision: 'abc^', path: 'a.ts' },
    });
  });

  it('uses the older commit of a comparison and the old name of a rename', () => {
    assert.deepEqual(
      resetSources({ path: 'new.ts', oldPath: 'old.ts', revision: 'head', baseRevision: 'base', list: 'changes' }),
      { atCommit: { revision: 'head', path: 'new.ts' }, beforeCommit: { revision: 'base', path: 'old.ts' } },
    );
  });
});

describe('openRevision', () => {
  it('opens a file at its commit, or at the version before a deletion', () => {
    assert.deepEqual(openRevision({ path: 'a.ts', revision: 'abc', status: 'M', list: 'changes' }), {
      revision: 'abc', path: 'a.ts',
    });
    assert.deepEqual(openRevision({ path: 'a.ts', revision: 'abc', status: 'D', list: 'changes' }), {
      revision: 'abc^', path: 'a.ts',
    });
    assert.deepEqual(
      openRevision({ path: 'a.ts', revision: 'head', baseRevision: 'base', status: 'D', list: 'changes' }),
      { revision: 'base', path: 'a.ts' },
    );
  });
});
