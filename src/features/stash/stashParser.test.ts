import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { GraphCommitDto } from '../../shared/graph/graphProtocol';
import {
    assertStashSelector,
    labelStashCommits,
    parseStashList,
    stashDropOrder,
} from './stashParser';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function commit(sha: string, refs: GraphCommitDto['refs'] = []): GraphCommitDto {
  return {
    sha,
    parents: [],
    subject: 's',
    author: 'A',
    authorEmail: 'a@x',
    authorDate: 1,
    refs,
  };
}

describe('parseStashList', () => {
  it('parses null-separated stash list records', () => {
    const output = [`stash@{0}`, SHA_A, 'On main: wip', `stash@{1}`, SHA_B, 'On main: older', ''].join(
      '\0',
    );
    assert.deepEqual(parseStashList(output), [
      { index: 0, selector: 'stash@{0}', sha: SHA_A, message: 'On main: wip' },
      { index: 1, selector: 'stash@{1}', sha: SHA_B, message: 'On main: older' },
    ]);
  });

  it('skips malformed records and empty output', () => {
    assert.deepEqual(parseStashList(''), []);
    assert.deepEqual(parseStashList(['not-a-stash', SHA_A, 'msg'].join('\0')), []);
    assert.deepEqual(parseStashList(['stash@{0}', 'short', 'msg'].join('\0')), []);
  });

  it('labels date-formatted selectors with the stash stack index', () => {
    const output = [
      'stash@{2 minutes ago}',
      SHA_A,
      'On main: wip',
      'stash@{1792523370}',
      SHA_B,
      'On main: older',
      '',
    ].join('\0');
    assert.deepEqual(parseStashList(output), [
      { index: 0, selector: 'stash@{0}', sha: SHA_A, message: 'On main: wip' },
      { index: 1, selector: 'stash@{1}', sha: SHA_B, message: 'On main: older' },
    ]);
  });
});

describe('stashDropOrder', () => {
  it('drops the highest index first and ignores duplicates', () => {
    assert.deepEqual(stashDropOrder(['stash@{0}', 'stash@{2}', 'stash@{0}', 'stash@{1}']), [
      'stash@{2}',
      'stash@{1}',
      'stash@{0}',
    ]);
  });

  it('rejects selectors that are not stash@{n}', () => {
    assert.throws(() => assertStashSelector('HEAD'), /Invalid stash selector/);
    assert.throws(() => stashDropOrder(['stash@{0}; rm -rf']), /Invalid stash selector/);
  });
});

describe('labelStashCommits', () => {
  it('replaces refs/stash and labels older stash commits', () => {
    const labeled = labelStashCommits(
      [
        commit(SHA_A, [{ kind: 'stash', name: 'stash' }]),
        commit(SHA_B),
        commit('c'.repeat(40), [{ kind: 'local', name: 'main', isHead: true }]),
      ],
      [
        { index: 0, selector: 'stash@{0}', sha: SHA_A, message: 'new' },
        { index: 1, selector: 'stash@{1}', sha: SHA_B, message: 'old' },
      ],
    );
    assert.deepEqual(labeled[0].refs, [{ kind: 'stash', name: 'stash@{0}' }]);
    assert.deepEqual(labeled[1].refs, [{ kind: 'stash', name: 'stash@{1}' }]);
    assert.deepEqual(labeled[2].refs, [{ kind: 'local', name: 'main', isHead: true }]);
  });

  it('keeps every stash index when two entries share a sha', () => {
    const [labeled] = labelStashCommits(
      [commit(SHA_A, [{ kind: 'stash', name: 'stash' }])],
      [
        { index: 0, selector: 'stash@{0}', sha: SHA_A, message: 'new' },
        { index: 3, selector: 'stash@{3}', sha: SHA_A, message: 'old' },
      ],
    );
    assert.deepEqual(labeled.refs, [
      { kind: 'stash', name: 'stash@{0}' },
      { kind: 'stash', name: 'stash@{3}' },
    ]);
  });
});
