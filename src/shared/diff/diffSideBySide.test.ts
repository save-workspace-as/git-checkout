import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildSideBySideRows, formatVisibleWhitespace } from './diffSideBySide';

describe('buildSideBySideRows', () => {
  it('pairs delete and add lines', () => {
    const rows = buildSideBySideRows([
      { id: '1', kind: 'del', text: 'old', selectable: true },
      { id: '2', kind: 'add', text: 'new', selectable: true },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].left.text, 'old');
    assert.equal(rows[0].right.text, 'new');
  });

  it('shows context on both sides', () => {
    const rows = buildSideBySideRows([
      { id: '1', kind: 'context', text: 'same', selectable: false },
    ]);
    assert.equal(rows[0].left.text, 'same');
    assert.equal(rows[0].right.text, 'same');
  });
});

describe('formatVisibleWhitespace', () => {
  it('marks spaces and tabs', () => {
    assert.equal(formatVisibleWhitespace('a b\t'), 'a·b→');
  });
});
