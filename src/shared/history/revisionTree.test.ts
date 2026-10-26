import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { isCommitTreePathContext } from './pathHistoryProtocol';
import { buildRevisionNodes, revisionPaths } from './revisionTree';

const options = { revision: 'abc123', list: 'changes' as const, tree: false };

describe('buildRevisionNodes', () => {
  it('lists files flat with the folder apart from the name, each usable as a menu context', () => {
    const [renamed] = buildRevisionNodes([{ path: 'src/b.ts', status: 'R100', oldPath: 'src/a.ts' }], {
      ...options,
      baseRevision: 'base00',
    });
    assert.equal(renamed.label, 'b.ts');
    assert.equal((renamed as { folder: string }).folder, 'src');
    assert.ok(isCommitTreePathContext(renamed));
    assert.deepEqual(
      [renamed.commitTreeKind, renamed.revision, renamed.baseRevision, renamed.oldPath, renamed.status, renamed.list],
      ['blob', 'abc123', 'base00', 'src/a.ts', 'R100', 'changes'],
    );
  });

  it('nests folders first in natural order, and folders are tree contexts', () => {
    const nodes = buildRevisionNodes(
      [{ path: 'z.ts' }, { path: 'src/f10.ts' }, { path: 'src/f2.ts' }, { path: 'src/lib/x.ts' }],
      { ...options, list: 'tree', tree: true },
    );
    assert.deepEqual(nodes.map((node) => node.label), ['src', 'z.ts']);
    const src = nodes[0];
    assert.equal(src.commitTreeKind, 'tree');
    assert.equal(src.path, 'src');
    assert.deepEqual((src.children ?? []).map((child) => child.label), ['lib', 'f2.ts', 'f10.ts']);
  });
});

describe('revisionPaths', () => {
  it('expands folders to their files and drops duplicates and junk', () => {
    const nodes = buildRevisionNodes([{ path: 'a/x.ts' }, { path: 'a/y.ts' }, { path: 'b.ts' }], { ...options, tree: true });
    assert.deepEqual(revisionPaths([nodes[0], nodes[1], nodes[1], null, 'x', {}]), ['a/x.ts', 'a/y.ts', 'b.ts']);
  });
});
