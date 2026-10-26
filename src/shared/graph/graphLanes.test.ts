import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
    emptyLaneState,
    type GraphLaneCommit,
    type GraphLaneRow,
    layoutGraph,
    mergeNodeMarker,
    withMergeSides,
} from './graphLanes';

function c(sha: string, ...parents: string[]): GraphLaneCommit {
  return { sha, parents };
}

/** Compact row description: column plus top/bottom segments as "from>to". */
function describeRow(row: GraphLaneRow): string {
  const edges = (list: GraphLaneRow['top']) => list.map((e) => `${e.from}>${e.to}`).join(',');
  return `${row.sha}@${row.column} top[${edges(row.top)}] bottom[${edges(row.bottom)}]`;
}

function describeAll(commits: GraphLaneCommit[]): string[] {
  return layoutGraph(commits).rows.map(describeRow);
}

// M merges feature F into B; both F and B come from A.
const BRANCH_AND_MERGE = [c('M', 'B', 'F'), c('F', 'A'), c('B', 'A'), c('A')];

describe('layoutGraph', () => {
  it('draws a straight line for linear history', () => {
    assert.deepEqual(describeAll([c('C', 'B'), c('B', 'A'), c('A')]), [
      'C@0 top[] bottom[0>0]',
      'B@0 top[0>0] bottom[0>0]',
      'A@0 top[0>0] bottom[]',
    ]);
  });

  it('opens a lane for a merged branch and closes it at the branch point', () => {
    assert.deepEqual(describeAll(BRANCH_AND_MERGE), [
      'M@0 top[] bottom[0>0,0>1]',
      'F@1 top[0>0,1>1] bottom[0>0,1>1]',
      'B@0 top[0>0,1>1] bottom[0>0,1>1]',
      'A@0 top[0>0,1>0] bottom[]',
    ]);
    const rows = layoutGraph(BRANCH_AND_MERGE).rows;
    assert.equal(rows[0].isMerge, true);
    assert.deepEqual(
      rows.map((r) => r.width),
      [2, 2, 2, 2],
    );
  });

  it('keeps a branch colour from the merge line down to its branch point', () => {
    const [merge, feature, , root] = layoutGraph(BRANCH_AND_MERGE).rows;
    const featureColor = merge.bottom.find((e) => e.to === 1)?.color;
    assert.notEqual(featureColor, merge.color);
    assert.equal(feature.color, featureColor);
    assert.equal(feature.bottom.find((e) => e.from === 1)?.color, featureColor);
    assert.equal(root.top.find((e) => e.from === 1)?.color, featureColor);
  });

  it('fans out every parent of an octopus merge', () => {
    assert.deepEqual(
      describeAll([c('M', 'a', 'b', 'd'), c('d', 'r'), c('b', 'r'), c('a', 'r'), c('r')]),
      [
        'M@0 top[] bottom[0>0,0>1,0>2]',
        'd@2 top[0>0,1>1,2>2] bottom[0>0,1>1,2>2]',
        'b@1 top[0>0,1>1,2>2] bottom[0>0,1>1,2>2]',
        'a@0 top[0>0,1>1,2>2] bottom[0>0,1>1,2>2]',
        'r@0 top[0>0,1>0,2>0] bottom[]',
      ],
    );
  });

  it('starts unrelated root histories in the first lane with a new colour', () => {
    const rows = layoutGraph([c('X'), c('Y')]).rows;
    assert.deepEqual(rows.map(describeRow), ['X@0 top[] bottom[]', 'Y@0 top[] bottom[]']);
    assert.notEqual(rows[0].color, rows[1].color);
  });

  it('closes the gap a branch leaves when it joins another, moving the lanes to its right over', () => {
    const rows = layoutGraph([
      c('P', 'A'),
      c('Q', 'A'),
      c('R', 'C'),
      c('A', 'Z'),
      c('S', 'Y'),
    ]).rows;
    // Q's lane ends at A; R's line, which waits for C in lane 2, bends into lane 1 below A.
    assert.equal(rows[3].top.find((e) => e.from === 1)?.to, 0);
    assert.ok(rows[3].bottom.some((e) => e.from === 2 && e.to === 1));
    assert.deepEqual(rows.map((r) => r.column), [0, 1, 2, 0, 2]);
    // No lane is left empty: after A only Z and C are waited for.
    assert.deepEqual(rows.map((r) => r.width), [1, 2, 3, 3, 3]);
  });

  it('never leaves an empty lane between branches that are still open', () => {
    // Ten branches start, the middle eight end, and the outer two keep going.
    const branches = Array.from({ length: 10 }, (_, i) => c(`B${i}`, i === 0 || i === 9 ? `T${i}` : 'M'));
    const rows = layoutGraph([...branches, c('M', 'END'), c('X', 'T0')]).rows;
    const last = rows.at(-1)!;
    const used = new Set([...last.top, ...last.bottom].flatMap((e) => [e.from, e.to]).concat(last.column));
    assert.equal(last.width, used.size, 'every lane the row reserves draws something');
  });

  it('gives the same result when commits arrive in two pages', () => {
    const whole = layoutGraph(BRANCH_AND_MERGE).rows;
    const first = layoutGraph(BRANCH_AND_MERGE.slice(0, 2));
    const second = layoutGraph(BRANCH_AND_MERGE.slice(2), first.state);
    assert.deepEqual([...first.rows, ...second.rows], whole);
  });

  it('does not mutate the state passed in', () => {
    const state = layoutGraph(BRANCH_AND_MERGE.slice(0, 2)).state;
    const snapshot = JSON.parse(JSON.stringify(state));
    layoutGraph(BRANCH_AND_MERGE.slice(2), state);
    assert.deepEqual(state, snapshot);
  });

  it('returns an empty state for no commits', () => {
    assert.deepEqual(layoutGraph([]), { rows: [], state: emptyLaneState() });
  });
});

describe('withMergeSides', () => {
  // M merges side S2 -> S1 (branched from A) into B; Git listed first-parent history only.
  const firstParent = [c('M', 'B', 'S2'), c('B', 'A'), c('A')];
  const side = [c('S2', 'S1'), c('S1', 'A')];

  it('keeps only the first parent of a collapsed merge, so no line leads to a commit that is not listed', () => {
    assert.deepEqual(withMergeSides(firstParent, new Set(), new Map()).map((commit) => commit.parents), [['B'], ['A'], []]);
  });

  it('lists the merged-in side right after a merge the person expanded, with both parents', () => {
    const rows = withMergeSides(firstParent, new Set(['M']), new Map([['M', side]]));
    assert.deepEqual(rows.map((commit) => commit.sha), ['M', 'S2', 'S1', 'B', 'A']);
    assert.deepEqual(rows[0].parents, ['B', 'S2']);
    // Every line ends at a listed commit.
    const listed = new Set(rows.map((commit) => commit.sha));
    assert.ok(rows.every((commit) => commit.parents.every((parent) => listed.has(parent))));
  });

  it('keeps a merge collapsed while its side has not arrived', () => {
    assert.deepEqual(withMergeSides(firstParent, new Set(['M']), new Map())[0].parents, ['B']);
  });

  it('collapses merges inside an expanded side unless they are expanded too', () => {
    const nested = [c('S2', 'S1', 'T1'), c('S1', 'A')];
    const rows = withMergeSides(firstParent, new Set(['M']), new Map([['M', nested]]));
    assert.deepEqual(rows.find((commit) => commit.sha === 'S2')?.parents, ['S1']);
  });

  it('does not list a commit twice', () => {
    const rows = withMergeSides(firstParent, new Set(['M']), new Map([['M', [...side, c('A')]]]));
    assert.equal(rows.filter((commit) => commit.sha === 'A').length, 1);
  });
});

describe('mergeNodeMarker', () => {
  it('draws nothing unless collapse is enabled on a merge', () => {
    assert.equal(mergeNodeMarker(2, false, false), 'none');
    assert.equal(mergeNodeMarker(1, true, false), 'none');
    assert.equal(mergeNodeMarker(0, true, false), 'none');
  });

  it('uses + while collapsed and − after the user expands that merge', () => {
    assert.equal(mergeNodeMarker(2, true, false), 'collapsed');
    assert.equal(mergeNodeMarker(3, true, true), 'expanded');
  });
});
