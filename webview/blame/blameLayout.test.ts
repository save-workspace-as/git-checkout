import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { runStarts } from './blameLayout';

describe('runStarts', () => {
  it('marks the first line of each run of one commit and skips blank entries', () => {
    assert.deepEqual(runStarts(['', 'a', 'a', 'b', 'b', '', 'b']), [false, true, false, true, false, false, true]);
  });
});
