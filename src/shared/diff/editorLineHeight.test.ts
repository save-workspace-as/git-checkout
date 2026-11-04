import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { editorLineHeight } from './editorLineHeight';

describe('editorLineHeight', () => {
  it('follows the ratio VS Code uses on each platform', () => {
    assert.equal(editorLineHeight(12, true), 18);
    assert.equal(editorLineHeight(14, true), 21);
    assert.equal(editorLineHeight(14, false), 19);
    assert.equal(editorLineHeight(13, true), 20);
  });

  it('is never below the editor minimum', () => {
    assert.equal(editorLineHeight(4, false), 8);
  });
});
