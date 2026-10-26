import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { revealStep } from './graphReveal';

describe('revealStep', () => {
  const loaded = new Set(['a', 'b']);
  const cases: [string, string, boolean, number, ReturnType<typeof revealStep>][] = [
    ['found in loaded commits', 'b', true, 0, 'found'],
    ['found even when nothing more to load', 'a', false, 30, 'found'],
    ['not loaded and more pages exist', 'z', true, 0, 'loadMore'],
    ['not loaded, last page reached', 'z', false, 3, 'notFound'],
    ['not loaded, page cap reached', 'z', true, 3, 'notFound'],
  ];
  for (const [name, sha, hasMore, pages, expected] of cases) {
    it(name, () => {
      assert.equal(revealStep(loaded, sha, hasMore, pages, 3), expected);
    });
  }
});
