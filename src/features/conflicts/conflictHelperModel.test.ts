import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  abortGitCommand,
  buildConflictFile,
  buildConflictFiles,
  continueGitCommand,
  parseLsFilesUnmerged,
  parsePorcelainV2Unmerged,
  scenarioFromPorcelainXy,
  wrapConflictIndex,
} from './conflictHelperModel';

describe('conflictHelperModel', () => {
  it('parses porcelain v2 unmerged records', () => {
    const line =
      'u UU N... 100644 100644 100644 100644 abc def ghi path/with space.txt';
    const entries = parsePorcelainV2Unmerged(`${line}\0`);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.xy, 'UU');
    assert.equal(entries[0]?.path, 'path/with space.txt');
  });

  it('parses ls-files unmerged stages', () => {
    const output = [
      '100644 abc 1\tf.txt',
      '100644 def 2\tf.txt',
      '100644 ghi 3\tf.txt',
    ].join('\n');
    const map = parseLsFilesUnmerged(output);
    assert.equal(map.get('f.txt')?.length, 3);
  });

  it('classifies deleted-by-us conflicts', () => {
    assert.equal(scenarioFromPorcelainXy('DU'), 'deleted-by-us');
    const file = buildConflictFile('gone.txt', 'DU', [{ mode: '100644', stage: 1 }], new Set());
    assert.equal(file.kind, 'text');
    assert.equal(file.mergeEditorSupported, false);
    assert.match(file.guidance, /deleted on your branch/);
  });

  it('marks submodule mode conflicts', () => {
    const file = buildConflictFile(
      'sub',
      'UU',
      [{ mode: '160000', stage: 2 }, { mode: '160000', stage: 3 }],
      new Set(),
    );
    assert.equal(file.kind, 'submodule');
    assert.equal(file.badge, 'submodule');
    assert.equal(file.mergeEditorSupported, false);
  });

  it('builds sorted conflict files from git output', () => {
    const porcelain =
      'u UU N... 100644 100644 100644 100644 a b c z.txt\0u UU N... 100644 100644 100644 100644 d e f a.txt\0';
    const ls = '100644 a 1\ta.txt\n100644 b 2\ta.txt\n';
    const files = buildConflictFiles(porcelain, ls);
    assert.deepEqual(files.map((f) => f.path), ['a.txt', 'z.txt']);
  });

  it('maps continue and abort commands by operation kind', () => {
    assert.equal(continueGitCommand('merge'), 'git merge --continue');
    assert.equal(abortGitCommand('rebase'), 'git rebase --abort');
  });

  it('wraps conflict indices', () => {
    assert.equal(wrapConflictIndex(-1, 3), 2);
    assert.equal(wrapConflictIndex(3, 3), 0);
  });
});
