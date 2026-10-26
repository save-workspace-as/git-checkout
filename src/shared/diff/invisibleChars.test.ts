import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { escapeHtml, markInvisibles } from './invisibleChars';

describe('markInvisibles', () => {
  it('draws spaces and tabs but not the markup around them', () => {
    assert.equal(
      markInvisibles('<span class="a b">x  y</span>\t'),
      '<span class="a b">x<span class="commit-invisible">··</span>y</span>' +
        '<span class="commit-invisible"><span class="commit-invisible-tab">→</span></span>',
    );
  });

  it('leaves entities intact and escapes plain text before drawing it', () => {
    assert.equal(markInvisibles('a&nbsp;b'), 'a&nbsp;b');
    assert.equal(markInvisibles(escapeHtml('<b> &')), '&lt;b&gt;<span class="commit-invisible">·</span>&amp;');
  });
});
