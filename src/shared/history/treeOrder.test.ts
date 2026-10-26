import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { compareTreeEntries } from './treeOrder';

describe('compareTreeEntries', () => {
  it('puts folders first and orders names naturally', () => {
    const rows = [
      { name: 'file10.ts', folder: false },
      { name: 'b', folder: true },
      { name: 'file2.ts', folder: false },
      { name: 'A', folder: true },
    ];
    rows.sort(compareTreeEntries);
    assert.deepEqual(rows.map((row) => row.name), ['A', 'b', 'file2.ts', 'file10.ts']);
  });
});
