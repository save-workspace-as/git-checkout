import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { matchLines } from './lineMatch';

const lines = (text: string): string[] => (text === '' ? [] : text.split(''));

/** The length of the longest common subsequence, by the textbook table. */
function lcsLength(a: string[], b: string[]): number {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table[0][0];
}

describe('matchLines', () => {
  it('pairs equal lines in order and leaves the others out', () => {
    assert.deepEqual(matchLines(lines('abcd'), lines('axcyd')), [0, undefined, 2, 4]);
    assert.deepEqual(matchLines(lines('abc'), lines('abc')), [0, 1, 2]);
    assert.deepEqual(matchLines(lines('abc'), lines('')), [undefined, undefined, undefined]);
    assert.deepEqual(matchLines(lines(''), lines('abc')), []);
  });

  it('finds as many pairs as the longest common subsequence, always in order and between equal lines', () => {
    let seed = 7;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let round = 0; round < 300; round++) {
      const make = (): string[] => Array.from({ length: Math.floor(random() * 12) }, () => 'abcd'[Math.floor(random() * 4)]);
      const a = make();
      const b = make();
      const matched = matchLines(a, b)!;
      const pairs = matched.flatMap((index, line) => (index === undefined ? [] : [[line, index]]));
      assert.equal(pairs.length, lcsLength(a, b), `${a.join('')} against ${b.join('')}`);
      assert.equal(pairs.every(([line, index]) => a[line] === b[index]), true);
      assert.equal(pairs.every(([, index], at) => at === 0 || index > pairs[at - 1][1]), true, 'in order');
    }
  });

  it('gives up on a comparison of lines that are all different, past the number of edits it is allowed', () => {
    assert.equal(matchLines(['a', 'b', 'c', 'd'], ['w', 'x', 'y', 'z'], 3), undefined);
  });
});
