import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { formatLineBlame, parseCommitInfo, relativeAge, type LineBlame } from './lineBlameFormat';

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const seconds = (ago: number): number => NOW / 1000 - ago;
const blame = (over: Partial<LineBlame> = {}): LineBlame => ({
  sha: 'abcdef1234567890',
  author: 'Ada Lovelace',
  authorMail: 'ada@example.com',
  authorTime: seconds(3 * 24 * 3600),
  summary: 'fix(parser): handle empty input',
  ...over,
});

describe('relativeAge', () => {
  const cases: [string, number, string][] = [
    ['under a minute', 20, 'this minute'],
    ['minutes', 5 * 60, '5 minutes ago'],
    ['hours', 3 * 3600, '3 hours ago'],
    ['one day', 24 * 3600, 'yesterday'],
    ['days', 3 * 24 * 3600, '3 days ago'],
    ['weeks', 14 * 24 * 3600, '2 weeks ago'],
    ['months', 65 * 24 * 3600, '2 months ago'],
    ['years', 800 * 24 * 3600, '2 years ago'],
  ];
  for (const [name, ago, expected] of cases) {
    it(`reads ${name}`, () => assert.equal(relativeAge(seconds(ago), NOW, 'en'), expected));
  }

  it('treats a time in the future as now', () => {
    assert.equal(relativeAge(seconds(-9999), NOW, 'en'), 'this minute');
  });
});

describe('formatLineBlame', () => {
  it('fills the default template', () => {
    assert.equal(formatLineBlame('', blame(), NOW, 'en'), 'Ada Lovelace, 3 days ago • fix(parser): handle empty input');
  });

  it('fills every token and leaves other text alone', () => {
    assert.equal(formatLineBlame('{hash} by {author} ({date}) {unknown}', blame(), NOW, 'en'), 'abcdef1 by Ada Lovelace (3 days ago) {unknown}');
  });

  it('gives the day and time with {datetime}', () => {
    assert.match(formatLineBlame('{datetime}', blame(), NOW, 'en'), /^Oct 27, 2026, \d{1,2}:\d{2}\s?[AP]M$/);
  });

  it('cuts a long summary', () => {
    const text = formatLineBlame('{summary}', blame({ summary: 'x'.repeat(200) }), NOW, 'en');
    assert.equal(text.length, 80);
    assert.ok(text.endsWith('…'));
  });

  it('says a line that is not committed yet is yours', () => {
    assert.equal(formatLineBlame('{author}', blame({ sha: '0'.repeat(40), author: 'Not Committed Yet' }), NOW, 'en'), 'You, uncommitted changes');
  });
});

describe('parseCommitInfo', () => {
  it('reads the fields and the whole message', () => {
    const info = parseCommitInfo('abc1234\x00Ada\x00ada@example.com\x001700000000\x00subject\n\nbody line\n');
    assert.deepEqual(info, { sha: 'abc1234', author: 'Ada', authorMail: 'ada@example.com', authorTime: 1700000000, message: 'subject\n\nbody line' });
  });

  it('keeps a message that has a NUL in it', () => {
    assert.equal(parseCommitInfo('abc1234\x00A\x00a@b\x001\x00one\x00two')?.message, 'one\x00two');
  });

  it('gives nothing for output that is not a commit', () => {
    assert.equal(parseCommitInfo(''), undefined);
    assert.equal(parseCommitInfo('fatal: bad object'), undefined);
    assert.equal(parseCommitInfo('abc1234\x00A\x00a@b\x001'), undefined);
  });
});
