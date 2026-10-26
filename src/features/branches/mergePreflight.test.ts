import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { GitCli } from '../../core/gitCli';
import { checkMergePreflight } from './mergePreflight';

function mockCli(handlers: {
  mergeBase?: string | Error;
  modernMergeTree?: string | Error;
  classicMergeTree?: string | Error;
}): GitCli {
  return {
    execRead: async (args: string[]) => {
      if (args[0] === 'merge-base') {
        if (handlers.mergeBase instanceof Error) {
          throw handlers.mergeBase;
        }
        return { stdout: `${handlers.mergeBase ?? 'base'}\n` };
      }
      if (args.includes('--write-tree')) {
        if (handlers.modernMergeTree instanceof Error) {
          throw handlers.modernMergeTree;
        }
        return { stdout: handlers.modernMergeTree ?? '' };
      }
      if (args[0] === 'merge-tree') {
        if (handlers.classicMergeTree instanceof Error) {
          throw handlers.classicMergeTree;
        }
        return { stdout: handlers.classicMergeTree ?? '' };
      }
      throw new Error(`unexpected: ${args.join(' ')}`);
    },
  } as GitCli;
}

describe('checkMergePreflight', () => {
  it('returns no conflict when merge-base fails', async () => {
    const result = await checkMergePreflight(mockCli({ mergeBase: new Error('no common') }), 'other');
    assert.deepEqual(result, { wouldConflict: false, conflictFiles: [] });
  });

  it('parses modern merge-tree conflicts', async () => {
    const cli = mockCli({
      modernMergeTree: 'CONFLICT (content): src/a.ts\nCONFLICT (content): src/a.ts\n',
    });
    const result = await checkMergePreflight(cli, 'feature');
    assert.equal(result.wouldConflict, true);
    assert.deepEqual(result.conflictFiles, ['src/a.ts']);
  });

  it('falls back to classic merge-tree output', async () => {
    const cli = mockCli({
      modernMergeTree: new Error('old git'),
      classicMergeTree: 'changed in both: lib/b.ts\n',
    });
    const result = await checkMergePreflight(cli, 'feature');
    assert.equal(result.wouldConflict, true);
    assert.deepEqual(result.conflictFiles, ['lib/b.ts']);
  });

  it('parses classic merge-tree stage lines from real git output', async () => {
    const cli = mockCli({
      modernMergeTree: new Error('old git'),
      classicMergeTree: [
        'changed in both',
        '  base   100644 deadbeef conflict.txt',
        '  our    100644 deadbeef conflict.txt',
      ].join('\n'),
    });
    const result = await checkMergePreflight(cli, 'feature');
    assert.equal(result.wouldConflict, true);
    assert.deepEqual(result.conflictFiles, ['conflict.txt']);
  });
});
