import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { isUncommittedSha } from './blameProtocol';

describe('blame protocol', () => {
  it('tells an uncommitted line from a committed one', () => {
    assert.equal(isUncommittedSha('0'.repeat(40)), true);
    assert.equal(isUncommittedSha('a'.repeat(40)), false);
  });
});
