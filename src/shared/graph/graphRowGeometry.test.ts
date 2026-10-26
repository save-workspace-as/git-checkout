import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { GraphLaneRow } from './graphLanes';
import { GRAPH_LANE_WIDTH, graphGeometry, laneX, rowInkLanes, rowPaths } from './graphRowGeometry';

describe('graphGeometry', () => {
  it('keeps the same lane positions when more lanes appear', () => {
    const narrow = graphGeometry(4);
    const wide = graphGeometry(24);
    assert.equal(narrow.laneWidth, GRAPH_LANE_WIDTH);
    assert.equal(wide.laneWidth, GRAPH_LANE_WIDTH);
    assert.equal(laneX(wide, 3), laneX(narrow, 3));
  });

  it('treats zero lanes as one', () => {
    assert.deepEqual(graphGeometry(0), graphGeometry(1));
  });
});

describe('rowInkLanes', () => {
  it('ignores reserved lanes the row does not draw', () => {
    const row: GraphLaneRow = {
      sha: 'a',
      column: 0,
      color: 0,
      isMerge: false,
      top: [{ from: 0, to: 0, color: 0 }],
      bottom: [{ from: 0, to: 0, color: 0 }],
      width: 6,
    };
    assert.equal(rowInkLanes(row), 1);
    assert.equal(graphGeometry(rowInkLanes(row)).width, graphGeometry(1).width);
  });
});

describe('rowPaths', () => {
  const geometry = graphGeometry(2);
  const x0 = laneX(geometry, 0);
  const x1 = laneX(geometry, 1);
  const r = geometry.laneWidth / 2;

  it('draws straight lines for lanes that pass through', () => {
    const row: GraphLaneRow = {
      sha: 'a',
      column: 0,
      color: 0,
      isMerge: false,
      top: [{ from: 0, to: 0, color: 0 }],
      bottom: [{ from: 0, to: 0, color: 0 }],
      width: 1,
    };
    assert.deepEqual(rowPaths(row, geometry, 22), [
      { d: `M${x0} 0V11`, color: 0 },
      { d: `M${x0} 11V22`, color: 0 },
    ]);
  });

  it('leaves a merge node level, then turns down into the parent lane with a rounded corner', () => {
    const row: GraphLaneRow = {
      sha: 'm',
      column: 0,
      color: 0,
      isMerge: true,
      top: [],
      bottom: [{ from: 0, to: 1, color: 3 }],
      width: 2,
    };
    assert.deepEqual(rowPaths(row, geometry, 22), [
      { d: `M${x0} 11H${x1 - r}Q${x1} 11 ${x1} ${11 + r}V22`, color: 3 },
    ]);
  });

  it('brings a converging lane down its own lane, then level into the commit', () => {
    const row: GraphLaneRow = {
      sha: 'b',
      column: 0,
      color: 0,
      isMerge: false,
      top: [{ from: 1, to: 0, color: 2 }],
      bottom: [],
      width: 2,
    };
    assert.deepEqual(rowPaths(row, geometry, 22), [
      { d: `M${x1} 0V${11 - r}Q${x1} 11 ${x1 - r} 11H${x0}`, color: 2 },
    ]);
  });

  it('bends a lane that moves over to close a gap, without a corner, since it does not meet the commit', () => {
    const row: GraphLaneRow = {
      sha: 'c', column: 0, color: 0, isMerge: false,
      top: [{ from: 0, to: 0, color: 0 }],
      bottom: [{ from: 0, to: 0, color: 0 }, { from: 2, to: 1, color: 4 }],
      width: 3,
    };
    const x2 = laneX(graphGeometry(3), 2);
    assert.equal(rowPaths(row, graphGeometry(3), 22)[2].d, `M${x2} 11C${x2} 22 ${laneX(graphGeometry(3), 1)} 11 ${laneX(graphGeometry(3), 1)} 22`);
  });
});

