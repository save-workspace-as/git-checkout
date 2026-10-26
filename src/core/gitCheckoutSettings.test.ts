import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { defaultGitCheckoutSettings } from './gitCheckoutSettings';

describe('defaultGitCheckoutSettings', () => {
  it('exposes conservative defaults', () => {
    assert.equal(defaultGitCheckoutSettings.leanBranchingStashOnSwitch(), false);
    assert.equal(defaultGitCheckoutSettings.gitSkipHooks(), false);
    assert.equal(defaultGitCheckoutSettings.networkTimeoutMs(), 300_000);
    assert.equal(defaultGitCheckoutSettings.watchDebounceMs(), 200);
  });
});
