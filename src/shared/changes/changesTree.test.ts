import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildChangeNodes, changeFiles, changeTargets, commandChangeTargets } from './changesTree';
import type { WorkingCopyEntryDto } from './workingCopyProtocol';

const entry = (path: string, group: WorkingCopyEntryDto['group'] = 'unstaged'): WorkingCopyEntryDto => ({
  path, group, status: group === 'untracked' ? 'untracked' : 'modified',
});

describe('buildChangeNodes', () => {
  it('lists changes flat with the folder apart from the name', () => {
    const [nested, top] = buildChangeNodes([entry('src/a/b.ts'), entry('z.ts', 'untracked')], false);
    assert.deepEqual([nested.kind, (nested as { label: string }).label, (nested as { folder: string }).folder], ['file', 'b.ts', 'src/a']);
    assert.equal((top as { untracked: boolean }).untracked, true);
  });

  it('nests folders first with natural ordering, and a folder covers every file below it', () => {
    const nodes = buildChangeNodes(
      [entry('b.ts'), entry('src/file10.ts'), entry('src/file2.ts'), entry('src/lib/x.ts'), entry('a.ts')],
      true,
    );
    assert.deepEqual(nodes.map((node) => node.label), ['src', 'a.ts', 'b.ts']);
    const src = nodes[0];
    assert.equal(src.kind, 'dir');
    if (src.kind === 'dir') {
      assert.deepEqual(src.children.map((child) => child.label), ['lib', 'file2.ts', 'file10.ts']);
      assert.deepEqual(src.files.map((file) => file.path).sort(), ['src/file10.ts', 'src/file2.ts', 'src/lib/x.ts']);
    }
    assert.equal(changeFiles(nodes).length, 5);
  });

  it('keeps a staged and an unstaged change to one path as separate rows', () => {
    const files = changeFiles(buildChangeNodes([entry('a.ts', 'staged'), entry('a.ts')], false));
    assert.equal(new Set(files.map((file) => file.key)).size, 2);
  });

  it('shows an ignored folder as one row', () => {
    const [node] = buildChangeNodes([{ ...entry('dist/'), status: 'ignored' }], false);
    assert.equal((node as { label: string }).label, 'dist');
  });
});

describe('changeTargets', () => {
  it('expands folders, drops duplicates and ignores unusable values', () => {
    const [dir] = buildChangeNodes([entry('src/a.ts'), entry('src/b.ts')], true);
    const targets = changeTargets([dir, { path: 'src/a.ts', side: 'unstaged' }, { path: '', side: 'staged' }, null, 'x']);
    assert.deepEqual(targets.map((target) => target.path), ['src/a.ts', 'src/b.ts']);
  });

  it('reads the context shape that menus used to pass', () => {
    assert.deepEqual(changeTargets([{ webviewSection: 'changesFile', path: 'a', side: 'staged', untracked: true }]), [
      { path: 'a', side: 'staged', untracked: true },
    ]);
  });
});

describe('commandChangeTargets', () => {
  const file = (path: string) => ({ kind: 'file', path, side: 'unstaged', untracked: false });
  const [dir] = buildChangeNodes([entry('pkg/a.ts'), entry('pkg/b.ts')], true);

  it('uses the clicked row, or the whole selection when a menu hands one over', () => {
    assert.deepEqual(commandChangeTargets(file('a.ts'), undefined, [file('z.ts')]).map((t) => t.path), ['a.ts']);
    assert.deepEqual(commandChangeTargets(file('a.ts'), [file('a.ts'), file('b.ts')], undefined).map((t) => t.path), ['a.ts', 'b.ts']);
  });

  it('uses what the list has selected when nothing is handed over, as Enter does', () => {
    assert.deepEqual(commandChangeTargets(undefined, undefined, [file('a.ts'), file('b.ts')]).map((t) => t.path), ['a.ts', 'b.ts']);
    assert.deepEqual(commandChangeTargets(undefined, [], [dir]).map((t) => t.path), ['pkg/a.ts', 'pkg/b.ts']);
  });

  it('has nothing to act on without a row or a selection', () => {
    assert.deepEqual(commandChangeTargets(undefined, undefined, []), []);
    assert.deepEqual(commandChangeTargets(undefined, undefined, undefined), []);
  });
});
