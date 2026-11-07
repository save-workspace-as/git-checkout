import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { saveStartPath } from './saveStartPath';

describe('saveStartPath', () => {
  it('starts in the folder of the last save', () => {
    assert.equal(saveStartPath('a.patch', '/work/patches', '/repo'), '/work/patches/a.patch');
  });
  it('starts in the fallback folder before anything was saved', () => {
    assert.equal(saveStartPath('a.patch', undefined, '/repo'), '/repo/a.patch');
  });
  it('is the bare name when there is neither', () => {
    assert.equal(saveStartPath('a.patch', undefined), 'a.patch');
  });
});
