import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { authorColor, authorInitials } from './authorAvatar';
import { GRAPH_COLOR_COUNT } from './graphLanes';

describe('authorInitials', () => {
  const cases: [string, string][] = [
    ['First Last', 'FL'],
    ['solo', 'S'],
    ['  Bruno Cardoso Lopes ', 'BL'],
    ['', '?'],
    ['élise müller', 'ÉM'],
  ];
  for (const [name, expected] of cases) {
    it(`${JSON.stringify(name)} -> ${expected}`, () => {
      assert.equal(authorInitials(name), expected);
    });
  }
});

describe('authorColor', () => {
  it('is stable and ignores case and surrounding spaces', () => {
    assert.equal(authorColor('A@Example.com '), authorColor('a@example.com'));
  });

  it('stays within the graph colour range', () => {
    for (const email of ['', 'a@b', 'someone@example.com', 'x'.repeat(200)]) {
      const color = authorColor(email);
      assert.ok(color >= 0 && color < GRAPH_COLOR_COUNT);
    }
  });
});
