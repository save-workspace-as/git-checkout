import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { firstMatchFrom, nextFindStep } from './graphFind';

describe('nextFindStep', () => {
  it('advances, and wraps to the first match only once the search is done', () => {
    assert.deepEqual(nextFindStep(0, 3, false, 1), { kind: 'goto', index: 1 });
    assert.deepEqual(nextFindStep(2, 3, true, 1), { kind: 'goto', index: 0 });
    assert.deepEqual(nextFindStep(2, 3, false, 1), { kind: 'wait' });
  });

  it('goes back, wrapping to the last match found', () => {
    assert.deepEqual(nextFindStep(2, 3, true, -1), { kind: 'goto', index: 1 });
    assert.deepEqual(nextFindStep(0, 3, true, -1), { kind: 'goto', index: 2 });
    assert.deepEqual(nextFindStep(-1, 3, false, -1), { kind: 'goto', index: 2 });
  });

  it('waits for the first match, or reports none once the search is done', () => {
    assert.deepEqual(nextFindStep(-1, 0, false, 1), { kind: 'wait' });
    assert.deepEqual(nextFindStep(-1, 0, true, 1), { kind: 'none' });
  });
});

describe('firstMatchFrom', () => {
  const positions = new Map([['a', 2], ['b', 10]]);

  it('picks the first match at or after the current row, counting unloaded matches as later', () => {
    assert.equal(firstMatchFrom(['a', 'b', 'z'], positions, 0), 0);
    assert.equal(firstMatchFrom(['a', 'b', 'z'], positions, 2), 0);
    assert.equal(firstMatchFrom(['a', 'b', 'z'], positions, 3), 1);
    assert.equal(firstMatchFrom(['a', 'b', 'z'], positions, 11), 2);
  });

  it('treats no current row as the top, and finds nothing when every match is above', () => {
    assert.equal(firstMatchFrom(['a'], positions, -1), 0);
    assert.equal(firstMatchFrom(['a', 'b'], positions, 11), -1);
  });
});
