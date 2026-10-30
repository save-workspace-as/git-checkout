import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { fitToWidth, GUTTER_MAX, GUTTER_MIN, gutterLines, gutterWidth, heatStep, summarizeRange } from './fileBlameLayout';
import type { LineBlame } from './lineBlameFormat';

const NOW = Date.UTC(2026, 9, 30) ;
const ago = (days: number): number => NOW / 1000 - days * 24 * 3600;
const blame = (sha: string, author: string, days: number): LineBlame => ({ sha, author, authorMail: '', authorTime: ago(days), summary: `by ${author}` });
const UNCOMMITTED = '0'.repeat(40);

describe('heatStep', () => {
  const cases: [number, number][] = [[0, 1], [6, 1], [7, 2], [29, 2], [30, 3], [179, 3], [180, 4], [364, 4], [365, 5], [4000, 5]];
  for (const [days, step] of cases) {
    it(`puts ${days} days old in step ${step}`, () => assert.equal(heatStep(ago(days), NOW), step));
  }
  it('puts a time in the future in the newest step', () => assert.equal(heatStep(ago(-3), NOW), 1));
});

describe('gutterLines', () => {
  const file = new Map<number, LineBlame>([
    [1, blame('aaa', 'Ada', 2)], [2, blame('aaa', 'Ada', 2)], [3, blame('bbb', 'Bob', 400)], [4, blame('aaa', 'Ada', 2)], [5, blame(UNCOMMITTED, 'x', 0)],
  ]);

  it('writes a commit once at the start of its run, and again when it comes back', () => {
    const lines = gutterLines(file, 5, (entry) => entry.author, NOW);
    assert.deepEqual(lines.map((line) => line.text), ['Ada', '', 'Bob', 'Ada', 'x']);
    assert.deepEqual(lines.map((line) => line.line), [0, 1, 2, 3, 4]);
  });

  it('gives each line the heat of its commit, and a line not committed the hottest', () => {
    assert.deepEqual(gutterLines(file, 5, () => '', NOW).map((line) => line.heat), [1, 1, 5, 1, 1]);
  });

  it('leaves out lines that have no blame, and starts a new run after the gap', () => {
    const gap = new Map(file);
    gap.delete(2);
    const lines = gutterLines(gap, 3, (entry) => entry.author, NOW);
    assert.deepEqual(lines.map((line) => [line.line, line.text]), [[0, 'Ada'], [2, 'Bob']]);
    const same = new Map<number, LineBlame>([[1, blame('aaa', 'Ada', 1)], [3, blame('aaa', 'Ada', 1)]]);
    assert.deepEqual(gutterLines(same, 3, (entry) => entry.author, NOW).map((line) => line.text), ['Ada', 'Ada']);
  });
});

describe('gutterWidth and fitToWidth', () => {
  const lines = (...texts: string[]) => texts.map((text, line) => ({ line, sha: String(line), heat: 1, text }));

  it('fits the longest text between the narrow and the wide end', () => {
    assert.equal(gutterWidth(lines('abc')), GUTTER_MIN);
    assert.equal(gutterWidth(lines('x'.repeat(25), 'y')), 25);
    assert.equal(gutterWidth(lines('x'.repeat(200))), GUTTER_MAX);
    assert.equal(gutterWidth([]), GUTTER_MIN);
  });

  it('cuts a longer text with an ellipsis, counting characters and not code units', () => {
    assert.equal(fitToWidth('short', 10), 'short');
    assert.equal(fitToWidth('abcdefghij', 5), 'abcd…');
    assert.equal(fitToWidth('a b c d e f', 4), 'a b…');
    assert.equal([...fitToWidth('😀'.repeat(10), 5)].length, 5);
  });
});

describe('summarizeRange', () => {
  const file = new Map<number, LineBlame>([
    [1, blame('aaa', 'Ada', 30)], [2, blame('bbb', 'Bob', 5)], [3, blame('aaa', 'Ada', 30)], [4, blame('ccc', 'Cy', 90)], [5, blame(UNCOMMITTED, 'Not Committed Yet', 0)],
  ]);

  it('names the newest change and the authors by how many lines they wrote', () => {
    const summary = summarizeRange(file, 1, 4);
    assert.equal(summary.recent?.sha, 'bbb');
    assert.deepEqual(summary.authors, [{ name: 'Ada', lines: 2 }, { name: 'Bob', lines: 1 }, { name: 'Cy', lines: 1 }]);
  });

  it('counts a line not committed as the newest change, but not as an author', () => {
    const summary = summarizeRange(file, 1, 5);
    assert.equal(summary.recent?.sha, UNCOMMITTED);
    assert.deepEqual(summary.authors.map((author) => author.name), ['Ada', 'Bob', 'Cy']);
  });

  it('breaks a tie on lines by name, and copes with a range that has no blame', () => {
    assert.deepEqual(summarizeRange(file, 2, 4).authors.map((author) => author.name), ['Ada', 'Bob', 'Cy']);
    assert.deepEqual(summarizeRange(file, 50, 60), { recent: undefined, authors: [] });
  });
});
