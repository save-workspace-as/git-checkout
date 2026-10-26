import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { AUTO_STASH_MESSAGE_PATTERN, autoStashMessage } from './autoStash';

describe('autoStashMessage', () => {
  it('names the app and the time, like "Git Checkout autostash 22 Oct 2026 at 11:34"', () => {
    assert.equal(autoStashMessage(new Date(2026, 9, 22, 11, 34)), 'Git Checkout autostash 22 Oct 2026 at 11:34');
  });

  it('pads the time, leaves the day alone and uses English month names', () => {
    assert.equal(autoStashMessage(new Date(2026, 0, 5, 3, 7)), 'Git Checkout autostash 5 Jan 2026 at 03:07');
    assert.equal(autoStashMessage(new Date(2026, 11, 31, 23, 59)), 'Git Checkout autostash 31 Dec 2026 at 23:59');
  });

  it('is recognized by its pattern, and defaults to now', () => {
    assert.match(autoStashMessage(), AUTO_STASH_MESSAGE_PATTERN);
    assert.doesNotMatch('WIP on main', AUTO_STASH_MESSAGE_PATTERN);
  });
});
