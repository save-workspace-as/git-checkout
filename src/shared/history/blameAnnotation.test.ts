import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { BlameLineDto } from './blameProtocol';
import type { CommitDiffLineDto } from './commitDetailsProtocol';
import { annotateDiffLines } from './blameAnnotation';

const blame = (line: number, sha: string, summary = `commit ${sha}`): BlameLineDto => ({
  line, text: '', sha, author: 'Ada', authorMail: 'ada@example.com', authorTime: 1000, summary, groupStart: true,
});

describe('annotateDiffLines', () => {
  const lines: CommitDiffLineDto[] = [
    { kind: 'hunk', text: '@@ -1,3 +1,3 @@' },
    { kind: 'context', text: 'a', line: 1 },
    { kind: 'del', text: 'b', line: 2 },
    { kind: 'add', text: 'B', line: 2 },
    { kind: 'context', text: 'c', line: 3 },
  ];

  it('looks up added and unchanged lines after the commit and removed lines before it', () => {
    const result = annotateDiffLines(
      lines,
      [blame(1, 'aaa'), blame(2, 'ccc'), blame(3, 'aaa')],
      [blame(1, 'aaa'), blame(2, 'bbb'), blame(3, 'aaa')],
    );
    assert.deepEqual(result.shas, ['', 'aaa', 'bbb', 'ccc', 'aaa']);
    assert.deepEqual(Object.keys(result.commits).sort(), ['aaa', 'bbb', 'ccc']);
    assert.equal(result.commits.bbb.summary, 'commit bbb');
  });

  it('leaves a line blank when blame has no answer or the line is not committed', () => {
    const result = annotateDiffLines(lines, [blame(2, '0000000000000000000000000000000000000000')], []);
    assert.deepEqual(result.shas, ['', '', '', '', '']);
    assert.deepEqual(result.commits, {});
  });
});
