import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { aiBodyAttribute } from './aiAttribute';

describe('aiBodyAttribute', () => {
  it('writes nothing while AI is on, and marks the body when it is off', () => {
    assert.equal(aiBodyAttribute(true), '');
    assert.equal(aiBodyAttribute(false), ' data-ai="off"');
  });
});
