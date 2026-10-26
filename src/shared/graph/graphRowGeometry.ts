import type { GraphLaneRow } from './graphLanes';

export const GRAPH_LANE_WIDTH = 11;
const GRAPH_PAD = 4;

export interface GraphGeometry {
  laneWidth: number;
  /** Width of the graph column in pixels. */
  width: number;
}

/** Lane spacing stays fixed so loading more commits does not move lines already drawn. */
export function graphGeometry(maxLanes: number): GraphGeometry {
  const lanes = Math.max(1, maxLanes);
  return { laneWidth: GRAPH_LANE_WIDTH, width: GRAPH_PAD * 2 + GRAPH_LANE_WIDTH * lanes };
}

export function laneX(geometry: GraphGeometry, lane: number): number {
  return GRAPH_PAD + geometry.laneWidth * lane + geometry.laneWidth / 2;
}

/** Lanes this row actually draws, including the commit node. */
export function rowInkLanes(row: GraphLaneRow): number {
  let max = row.column;
  for (const edge of row.top) {
    max = Math.max(max, edge.from, edge.to);
  }
  for (const edge of row.bottom) {
    max = Math.max(max, edge.from, edge.to);
  }
  return max + 1;
}

/** Where this row's subject starts: just after the last line it draws. */
export function rowTextOffset(row: GraphLaneRow, geometry: GraphGeometry): number {
  return GRAPH_PAD + geometry.laneWidth * rowInkLanes(row);
}

export interface GraphPath {
  d: string;
  color: number;
}

function segment(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) {
    return `M${x1} ${y1}V${y2}`;
  }
  return `M${x1} ${y1}C${x1} ${y2} ${x2} ${y1} ${x2} ${y2}`;
}

/**
 * A line that meets the commit from another lane: straight along its own lane,
 * a rounded corner, then level with the commit. `fromNode` turns it around: level out of the commit, then down.
 */
function elbow(laneX: number, nodeX: number, mid: number, height: number, radius: number, fromNode: boolean): string {
  const toward = nodeX > laneX ? 1 : -1;
  if (fromNode) {
    return `M${nodeX} ${mid}H${laneX + toward * radius}Q${laneX} ${mid} ${laneX} ${mid + radius}V${height}`;
  }
  return `M${laneX} 0V${mid - radius}Q${laneX} ${mid} ${laneX + toward * radius} ${mid}H${nodeX}`;
}

export function rowPaths(row: GraphLaneRow, geometry: GraphGeometry, height: number): GraphPath[] {
  const mid = height / 2;
  const x = (lane: number) => laneX(geometry, lane);
  const radius = Math.min(geometry.laneWidth / 2, mid);
  return [
    ...row.top.map((e) => ({
      d: e.to === row.column && e.from !== e.to
        ? elbow(x(e.from), x(e.to), mid, height, radius, false)
        : segment(x(e.from), 0, x(e.to), mid),
      color: e.color,
    })),
    ...row.bottom.map((e) => ({
      d: e.from === row.column && e.from !== e.to
        ? elbow(x(e.to), x(e.from), mid, height, radius, true)
        : segment(x(e.from), mid, x(e.to), height),
      color: e.color,
    })),
  ];
}
