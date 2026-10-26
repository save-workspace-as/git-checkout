import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  graphNavigationTarget,
  graphSelectionRange,
  isGraphNavigationKey,
  scrollTopToReveal,
} from './graphKeyboard';

describe('graph keyboard navigation', () => {
  it('recognises only navigation keys', () => {
    assert.ok(isGraphNavigationKey('ArrowDown'));
    assert.ok(!isGraphNavigationKey('Enter'));
  });

  it('moves one row, a page, or to either end, and stops at the edges', () => {
    const cases: [Parameters<typeof graphNavigationTarget>[0], number, number][] = [
      ['ArrowDown', 3, 4],
      ['ArrowDown', 9, 9],
      ['ArrowUp', 3, 2],
      ['ArrowUp', 0, 0],
      ['PageDown', 3, 13],
      ['PageDown', 95, 99],
      ['PageUp', 3, 0],
      ['PageUp', 50, 40],
      ['Home', 50, 0],
      ['End', 50, 99],
    ];
    for (const [key, current, expected] of cases) {
      assert.equal(graphNavigationTarget(key, current, current === 9 ? 10 : 100, 10), expected, `${key} from ${current}`);
    }
  });

  it('starts at the first row when nothing is current, and ignores an empty list', () => {
    assert.equal(graphNavigationTarget('ArrowDown', -1, 5, 10), 0);
    assert.equal(graphNavigationTarget('ArrowUp', -1, 5, 10), 0);
    assert.equal(graphNavigationTarget('ArrowDown', -1, 0, 10), -1);
  });

  it('orders a selection range whichever way it was extended', () => {
    assert.deepEqual(graphSelectionRange(2, 5), [2, 5]);
    assert.deepEqual(graphSelectionRange(5, 2), [2, 5]);
  });

  it('scrolls only as far as needed to show a row below the header', () => {
    // Viewport 220px = header plus nine rows' worth; rows are 22px.
    assert.equal(scrollTopToReveal(2, 0, 220), 0);
    assert.equal(scrollTopToReveal(20, 0, 220), 20 * 22 + 22 + 22 - 220);
    assert.equal(scrollTopToReveal(1, 220, 220), 22);
    assert.equal(scrollTopToReveal(0, 220, 220), 0);
  });
});
