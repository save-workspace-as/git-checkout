import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { parseGitBlame } from './gitBlameParser';

const ADA = 'a'.repeat(40);
const PARENT = 'c'.repeat(40);
const ZERO = '0'.repeat(40);

function blameFixture(): string {
  return [
    `${ADA} 1 1 2`,
    'author Ada Lovelace',
    'author-mail <ada@example.com>',
    'author-time 1700000000',
    'author-tz +0000',
    'committer Ada Lovelace',
    'committer-mail <ada@example.com>',
    'committer-time 1700000000',
    'committer-tz +0000',
    'summary Introduce file',
    `previous ${PARENT} old name.txt`,
    'filename notes.txt',
    '\talpha',
    `${ADA} 2 2`,
    '\t',
    `${ZERO} 3 3 1`,
    'author Not Committed Yet',
    'author-mail <not.committed.yet>',
    'author-time 1700000100',
    'author-tz +0000',
    'committer Not Committed Yet',
    'committer-mail <not.committed.yet>',
    'committer-time 1700000100',
    'committer-tz +0000',
    'summary ',
    'boundary',
    'filename notes.txt',
    '\tgamma',
    '',
  ].join('\n');
}

describe('parseGitBlame', () => {
  it('parses grouped porcelain, abbreviated repeats, and uncommitted lines', () => {
    const lines = parseGitBlame(blameFixture());
    assert.equal(lines.length, 3);
    assert.equal(lines[0]?.text, 'alpha');
    assert.equal(lines[0]?.author, 'Ada Lovelace');
    assert.equal(lines[0]?.authorMail, 'ada@example.com');
    assert.equal(lines[0]?.authorTime, 1700000000);
    assert.equal(lines[0]?.summary, 'Introduce file');
    assert.equal(lines[0]?.previousSha, PARENT);
    assert.equal(lines[0]?.previousPath, 'old name.txt');
    assert.equal(lines[1]?.text, '');
    assert.equal(lines[1]?.sha, ADA);
    assert.equal(lines[1]?.finalLine, 2);
    assert.equal(lines[1]?.author, 'Ada Lovelace');
    assert.equal(lines[2]?.sha, ZERO);
    assert.equal(lines[2]?.text, 'gamma');
    assert.equal(lines[2]?.summary, '');
    assert.equal(lines[2]?.authorTime, 1700000100);
  });

  it('returns no lines for empty output and rejects a malformed header', () => {
    assert.deepEqual(parseGitBlame(''), []);
    assert.deepEqual(parseGitBlame('\n'), []);
    assert.throws(() => parseGitBlame('not a blame header\n'), /Unrecognized blame header/);
  });
});
