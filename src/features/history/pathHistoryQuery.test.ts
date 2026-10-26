import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { GRAPH_LOG_FORMAT } from '../graph/commitGraphService';
import { buildPathHistoryLogArgs, buildResetFileArgs, buildResetPreviewArgs } from './pathHistoryQuery';

const file = {
  scope: 'file' as const,
  path: 'src/app.ts',
  follow: true,
  includeMerges: false,
  skip: 0,
};

describe('buildPathHistoryLogArgs', () => {
  it('follows a file and omits merge commits unless requested', () => {
    const hidden = buildPathHistoryLogArgs(file);
    assert.ok(hidden.includes('--follow'));
    assert.ok(hidden.includes('--no-merges'));
    assert.ok(hidden.includes('--no-patch'));
    assert.deepEqual(hidden.slice(-2), ['--', 'src/app.ts']);

    const included = buildPathHistoryLogArgs({ ...file, includeMerges: true, follow: false });
    assert.ok(!included.includes('--no-merges'));
    assert.ok(!included.includes('--follow'));
    assert.ok(!included.includes('-m'));
    assert.ok(included.includes(`--pretty=format:${GRAPH_LOG_FORMAT}`));

    const followedMerges = buildPathHistoryLogArgs({ ...file, includeMerges: true, follow: true });
    assert.ok(followedMerges.includes('--follow'));
    assert.ok(followedMerges.includes('-m'));
    assert.ok(!followedMerges.includes('--no-merges'));
  });

  it('does not pass --follow for a directory', () => {
    const args = buildPathHistoryLogArgs({
      scope: 'directory',
      path: 'src',
      follow: true,
      includeMerges: true,
      skip: 40,
      limit: 20,
    });
    assert.ok(!args.includes('--follow'));
    assert.ok(args.includes('--skip=40'));
    assert.ok(args.includes('20'));
    assert.deepEqual(args.slice(-2), ['--', 'src']);
  });

  it('uses -L for hunk history and does not combine it with --follow', () => {
    const args = buildPathHistoryLogArgs({
      scope: 'hunk',
      path: 'src/app.ts',
      startLine: 4,
      endLine: 9,
      follow: true,
      includeMerges: false,
      skip: 0,
    });
    assert.ok(!args.includes('--follow'));
    assert.ok(!args.includes('--'));
    assert.deepEqual(args.slice(-2), ['-L', '4,9:src/app.ts']);
    assert.ok(args.includes('--no-merges'));
  });
});

describe('reset file args', () => {
  it('checks the file out of the selected revision and previews that diff', () => {
    assert.deepEqual(buildResetFileArgs('abc1234', 'dir\\file.txt'), [
      'checkout',
      'abc1234',
      '--',
      'dir/file.txt',
    ]);
    assert.deepEqual(buildResetPreviewArgs('abc1234', 'dir/file.txt'), [
      'diff',
      '--no-color',
      '--stat',
      'abc1234',
      '--',
      'dir/file.txt',
    ]);
  });
});
