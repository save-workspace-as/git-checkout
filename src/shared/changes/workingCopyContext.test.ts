import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { isWorkingCopySubmoduleContext, workingCopySubmoduleContext } from './workingCopyContext';

describe('workingCopySubmoduleContext', () => {
  it('accepts a gitlink row context', () => {
    const context = workingCopySubmoduleContext('libs/mid', 'unstaged');
    assert.equal(isWorkingCopySubmoduleContext(context), true);
  });

  const rejected: [string, unknown][] = [
    ['null', null],
    ['file row', { webviewSection: 'workingCopy', path: 'a.ts', side: 'staged', submodule: false }],
    ['commit row', { webviewSection: 'commit', path: 'libs/mid', side: 'unstaged', submodule: true }],
    ['missing path', { webviewSection: 'workingCopy', side: 'staged', submodule: true }],
  ];
  for (const [name, value] of rejected) {
    it(`rejects ${name}`, () => {
      assert.equal(isWorkingCopySubmoduleContext(value), false);
    });
  }
});
