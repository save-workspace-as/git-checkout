import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { pickFromSelection } from './filePick';

const file = (key: string) => ({ key, kind: 'file' });
const dir = (key: string) => ({ key, kind: 'dir' });

describe('pickFromSelection', () => {
  it('picks the row just added to the selection', () => {
    const result = pickFromSelection([file('a'), file('b')], new Set(['a']), 'a', false);
    assert.equal(result.target?.key, 'b');
    assert.deepEqual([...result.previous], ['a', 'b']);
  });

  it('does not pick the row that is already shown, nor a folder', () => {
    assert.equal(pickFromSelection([file('a')], new Set(), 'a', false).target, undefined);
    assert.equal(pickFromSelection([dir('d')], new Set(), undefined, false).target, undefined);
  });

  it('does not take the selection VS Code restores onto new rows for a pick, but remembers it', () => {
    const restored = pickFromSelection([file('a')], new Set(), undefined, true);
    assert.equal(restored.target, undefined);
    // The same row selected again once the quiet time is over is not new either.
    assert.equal(pickFromSelection([file('a')], restored.previous, undefined, false).target, undefined);
  });
});
