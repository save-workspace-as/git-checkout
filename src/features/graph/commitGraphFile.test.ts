import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { commitGraphHasChangedPaths, LARGE_REPOSITORY_KIB, objectsSizeKiB, wantsCommitGraph } from './commitGraphFile';

/** A commit-graph header whose chunk table lists `ids`. */
function header(ids: string[], magic = 'CGPH'): Uint8Array {
  const bytes = new Uint8Array(8 + 12 * (ids.length + 1));
  bytes.set([...magic].map((char) => char.charCodeAt(0)), 0);
  bytes[4] = 1;
  bytes[5] = 1;
  bytes[6] = ids.length;
  ids.forEach((id, index) => bytes.set([...id].map((char) => char.charCodeAt(0)), 8 + index * 12));
  return bytes;
}

describe('commitGraphHasChangedPaths', () => {
  it('finds the Bloom filter chunk in the chunk table', () => {
    assert.equal(commitGraphHasChangedPaths(header(['OIDF', 'OIDL', 'CDAT', 'GDA2', 'BIDX', 'BDAT'])), true);
    assert.equal(commitGraphHasChangedPaths(header(['OIDF', 'OIDL', 'CDAT'])), false);
  });

  it('says no for a file that is not a commit-graph, or too short to tell', () => {
    assert.equal(commitGraphHasChangedPaths(header(['BIDX'], 'NOPE')), false);
    assert.equal(commitGraphHasChangedPaths(new Uint8Array([67, 71])), false);
    const cut = header(['OIDF', 'BIDX']).subarray(0, 12);
    assert.equal(commitGraphHasChangedPaths(cut), false);
  });
});

describe('objectsSizeKiB', () => {
  it('adds the loose and the packed objects', () => {
    assert.equal(objectsSizeKiB('count: 1455\nsize: 17200\nin-pack: 2612245\npacks: 3\nsize-pack: 1700000\nprune-packable: 0\n'), 1_717_200);
    assert.equal(objectsSizeKiB(''), 0);
  });
});

describe('wantsCommitGraph', () => {
  const large = LARGE_REPOSITORY_KIB;
  it('writes one for a large repository that has none, or one without changed paths', () => {
    assert.equal(wantsCommitGraph(large, { kind: 'none' }), true);
    assert.equal(wantsCommitGraph(large, { kind: 'file', header: header(['OIDF', 'CDAT']) }), true);
  });

  it('leaves a small repository, a chain and a file with changed paths alone', () => {
    assert.equal(wantsCommitGraph(large - 1, { kind: 'none' }), false);
    assert.equal(wantsCommitGraph(large, { kind: 'chain' }), false);
    assert.equal(wantsCommitGraph(large, { kind: 'file', header: header(['OIDF', 'BIDX']) }), false);
  });
});
