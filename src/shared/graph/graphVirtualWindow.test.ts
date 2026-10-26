import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { computeVirtualWindow, GRAPH_ROW_HEIGHT } from './graphVirtualWindow';

describe('computeVirtualWindow', () => {
  it('renders only the rows around the viewport for a large history', () => {
    const rowCount = 50_000;
    const viewportHeight = 600;
    const window = computeVirtualWindow(10_000, viewportHeight, rowCount);
    const visibleCount = Math.ceil(viewportHeight / GRAPH_ROW_HEIGHT) + 20;

    assert.ok(window.end - window.start <= visibleCount);
    assert.equal(window.totalHeight, rowCount * GRAPH_ROW_HEIGHT);
    assert.ok(window.start > 0);
    assert.ok(window.end < rowCount);
  });

  it('clamps the window to the start of a short history', () => {
    const window = computeVirtualWindow(0, 200, 3);
    assert.equal(window.start, 0);
    assert.equal(window.end, 3);
    assert.equal(window.offsetY, 0);
  });
});
