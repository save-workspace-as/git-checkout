import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { applySuggestion, quoteFilterValue, suggestSearch } from './searchSuggestions';

const labels = (text: string, caret = text.length, context = {}): string[] =>
  suggestSearch(text, caret, context)?.items.map((item) => item.label) ?? [];

describe('suggestSearch', () => {
  it('offers the filters that start like what is typed', () => {
    assert.deepEqual(labels('pa'), ['path:']);
    assert.deepEqual(labels('s'), ['since:']);
    assert.deepEqual(labels('c'), ['content:']);
    assert.deepEqual(labels('re'), ['regex:']);
    assert.deepEqual(labels('A'), ['author:'], 'case does not matter');
  });

  it('offers nothing for an empty word unless asked, then every filter', () => {
    assert.equal(suggestSearch('', 0), undefined);
    assert.equal(suggestSearch('fix ', 4), undefined);
    assert.deepEqual(labels('', 0, { force: true }), ['author:', 'path:', 'since:', 'until:', 'content:', 'regex:']);
  });

  it('offers nothing for a word that is no filter, or a name that is typed whole', () => {
    assert.equal(suggestSearch('zzz', 3), undefined);
    assert.equal(suggestSearch('path', 4), undefined);
  });

  it('leaves out a filter already in the search', () => {
    assert.deepEqual(labels('path:src s'), ['since:']);
    assert.deepEqual(labels('author:ada a'), []);
  });

  it('works on the word at the caret, in the middle of the text', () => {
    const found = suggestSearch('fix pa login', 6)!;
    assert.deepEqual([found.start, found.end, found.items[0].label], [4, 6, 'path:']);
  });

  it('offers authors that contain what is typed, once and in the order given', () => {
    const authors = ['Ada Lovelace', 'Grace Hopper', 'Ada Lovelace', 'Alan Turing'];
    assert.deepEqual(labels('author:', undefined, { authors }), ['Ada Lovelace', 'Grace Hopper', 'Alan Turing']);
    assert.deepEqual(labels('author:lan', undefined, { authors }), ['Alan Turing']);
    assert.equal(suggestSearch('author:zzz', 10, { authors }), undefined);
    assert.equal(suggestSearch('author:ada', 10), undefined, 'no authors are known');
  });

  it('quotes an author with a space and offers dates for since and until', () => {
    const [ada] = suggestSearch('author:', 7, { authors: ['Ada Lovelace'] })!.items;
    assert.equal(ada.insert, 'author:"Ada Lovelace" ');
    assert.deepEqual(labels('since:', undefined, { today: '2026-10-29' }), ['yesterday', '1 week ago', '1 month ago', '3 months ago', '1 year ago', '2026-10-29']);
    assert.deepEqual(labels('until:"1 m', undefined, {}), ['1 month ago'], 'a quoted value is read to its end, spaces included');
    assert.deepEqual(labels('since:"3', undefined, {}), ['3 months ago']);
  });

  it('has no values to offer for the filters that take text', () => {
    assert.equal(suggestSearch('content:', 8), undefined);
    assert.equal(suggestSearch('regex:fo', 8), undefined);
    assert.equal(suggestSearch('nokey:', 6), undefined);
  });

  it('stops offering a value that is already typed whole', () => {
    assert.equal(suggestSearch('since:yesterday', 15), undefined);
  });
});

describe('applySuggestion', () => {
  it('puts a filter in place of the word, and leaves the caret after its colon', () => {
    const found = suggestSearch('fix pa', 6)!;
    assert.deepEqual(applySuggestion('fix pa', found, found.items[0]), { text: 'fix path:', caret: 9 });
  });

  it('puts a value in place of the word with a space after it, keeping the rest', () => {
    const text = 'author:ad login';
    const found = suggestSearch(text, 9, { authors: ['Ada Lovelace'] })!;
    assert.deepEqual(applySuggestion(text, found, found.items[0]), { text: 'author:"Ada Lovelace" login', caret: 22 });
  });

  it('quotes only what has a space', () => {
    assert.equal(quoteFilterValue('1 week ago'), '"1 week ago"');
    assert.equal(quoteFilterValue('yesterday'), 'yesterday');
  });
});
