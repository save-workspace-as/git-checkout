import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { l10nBodyAttribute, parseL10nAttribute } from './l10nAttribute';

/** What the browser hands back for an attribute value: the HTML escapes undone. */
function attributeValue(attribute: string): string {
  const match = / data-l10n="([^"]*)"/.exec(attribute);
  return (match?.[1] ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

describe('webview translations', () => {
  it('leaves the attribute out when there is no bundle, as in English', () => {
    assert.equal(l10nBodyAttribute(undefined), '');
    assert.equal(l10nBodyAttribute({}), '');
  });

  it('round-trips a bundle through the attribute, including quotes, tags and ampersands', () => {
    const bundle = { 'Say "hi" & <leave>': 'Dis "bonjour" & <partir>', Close: 'Fermer' };
    const attribute = l10nBodyAttribute(bundle);
    assert.doesNotMatch(attribute.slice(' data-l10n="'.length, -1), /["<>]/);
    assert.deepEqual(parseL10nAttribute(attributeValue(attribute)), bundle);
  });

  it('treats a missing, broken or non-object value as no translations', () => {
    for (const value of [undefined, '', '{not json', '[]', '"text"', 'null']) {
      assert.equal(parseL10nAttribute(value), undefined, String(value));
    }
    assert.deepEqual(parseL10nAttribute('{"a":"b","c":1}'), { a: 'b' });
  });
});
