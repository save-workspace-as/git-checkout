import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  changesCommitBlocker,
  DEFAULT_CHANGES_VIEW,
  filterChangeEntries,
  joinCommitMessage,
  parseStoredChangesView,
  splitCommitMessage,
  subjectLengthLevel,
  type ChangesViewOptions,
} from './changesProtocol';

describe('commit message form', () => {
  it('joins a subject and description with a blank line, and splits them back', () => {
    assert.equal(joinCommitMessage('  Fix it ', ''), 'Fix it');
    assert.equal(joinCommitMessage('Fix it', '  Why\nand how '), 'Fix it\n\nWhy\nand how');
    assert.deepEqual(splitCommitMessage('Fix it\n\nWhy\nand how\n'), { subject: 'Fix it', description: 'Why\nand how' });
    assert.deepEqual(splitCommitMessage('Only a subject\n'), { subject: 'Only a subject', description: '' });
  });

  it('needs something staged and a subject, except an amend needs no staged changes', () => {
    assert.equal(changesCommitBlocker(1, 'x', false), undefined);
    assert.equal(changesCommitBlocker(0, 'x', false), 'nothingStaged');
    assert.equal(changesCommitBlocker(2, '  ', false), 'noSubject');
    assert.equal(changesCommitBlocker(0, 'Reword', true), undefined);
  });
});

describe('Changes view options', () => {
  const entries = [
    { path: 'a.ts', group: 'unstaged', status: 'modified' },
    { path: 'new.ts', group: 'untracked', status: 'untracked' },
    { path: 'dist/', group: 'untracked', status: 'ignored' },
  ] as const;

  it('restores saved options and defaults the rest', () => {
    assert.deepEqual(parseStoredChangesView(undefined), DEFAULT_CHANGES_VIEW);
    assert.deepEqual(parseStoredChangesView({ mode: 'tree', hideUntracked: true, showIgnored: 'yes' }), {
      mode: 'tree', hideUntracked: true, showIgnored: false,
    });
    assert.equal(parseStoredChangesView({ mode: 'grid' }).mode, 'list');
  });

  it('hides untracked files on request, and shows ignored ones only when asked', () => {
    const paths = (options: Partial<ChangesViewOptions>) =>
      filterChangeEntries([...entries], { ...DEFAULT_CHANGES_VIEW, ...options }).map((entry) => entry.path);
    assert.deepEqual(paths({}), ['a.ts', 'new.ts']);
    assert.deepEqual(paths({ hideUntracked: true }), ['a.ts']);
    assert.deepEqual(paths({ showIgnored: true }), ['a.ts', 'new.ts', 'dist/']);
    assert.deepEqual(paths({ hideUntracked: true, showIgnored: true }), ['a.ts', 'dist/']);
  });
});

describe('subjectLengthLevel', () => {
  const limits = { warning: 5, limit: 8 };
  it('warns past the warning length and marks past the limit, ignoring outer spaces', () => {
    assert.equal(subjectLengthLevel(' 12345 ', limits), undefined);
    assert.equal(subjectLengthLevel('123456', limits), 'warning');
    assert.equal(subjectLengthLevel('123456789', limits), 'limit');
  });

  it('treats a length of 0 as off', () => {
    assert.equal(subjectLengthLevel('123456789', { warning: 0, limit: 0 }), undefined);
    assert.equal(subjectLengthLevel('123456789', { warning: 5, limit: 0 }), 'warning');
  });
});
