export const GRAPH_COLOR_COUNT = 8;

export interface GraphLaneCommit {
  sha: string;
  parents: string[];
}

/** A line segment within one row, from lane `from` to lane `to`. */
export interface GraphEdge {
  from: number;
  to: number;
  color: number;
}

export interface GraphLaneRow {
  sha: string;
  column: number;
  color: number;
  isMerge: boolean;
  /** Segments from the row's top edge to the commit's midline. */
  top: GraphEdge[];
  /** Segments from the commit's midline to the row's bottom edge. */
  bottom: GraphEdge[];
  /** Number of lane slots this row needs. */
  width: number;
}

export interface GraphLaneState {
  /** Commit each lane is waiting for, or null for a free lane. */
  lanes: (string | null)[];
  colors: number[];
  nextColor: number;
}

export function emptyLaneState(): GraphLaneState {
  return { lanes: [], colors: [], nextColor: 0 };
}

/**
 * Assigns lanes and line segments to commits listed children-before-parents
 * (`--date-order` or `--topo-order`). Pass the returned state to continue with the next page.
 */
export function layoutGraph(
  commits: readonly GraphLaneCommit[],
  initial: GraphLaneState = emptyLaneState(),
): { rows: GraphLaneRow[]; state: GraphLaneState } {
  const lanes = [...initial.lanes];
  const colors = [...initial.colors];
  let nextColor = initial.nextColor;
  const rows: GraphLaneRow[] = [];
  const takeColor = (): number => {
    const color = nextColor % GRAPH_COLOR_COUNT;
    nextColor += 1;
    return color;
  };
  const freeLane = (exclude: number): number => {
    const index = lanes.findIndex((sha, i) => sha === null && i !== exclude);
    return index >= 0 ? index : lanes.length;
  };

  for (const commit of commits) {
    const widthBefore = lanes.length;
    const waiting = lanes.flatMap((sha, i) => (sha === commit.sha ? [i] : []));

    let column: number;
    if (waiting.length > 0) {
      column = waiting[0];
    } else {
      column = freeLane(-1);
      lanes[column] = commit.sha;
      colors[column] = takeColor();
    }
    const color = colors[column];

    const top: GraphEdge[] = [];
    lanes.forEach((sha, i) => {
      if (sha === null || (i === column && waiting.length === 0)) {
        return;
      }
      top.push({ from: i, to: sha === commit.sha ? column : i, color: colors[i] });
    });
    for (const i of waiting.slice(1)) {
      lanes[i] = null;
    }

    const [firstParent, ...otherParents] = commit.parents;
    lanes[column] = firstParent ?? null;

    const extra: GraphEdge[] = [];
    for (const parent of otherParents) {
      let target = lanes.findIndex((sha, i) => sha === parent && i !== column);
      if (target < 0) {
        target = freeLane(column);
        lanes[target] = parent;
        colors[target] = takeColor();
      }
      extra.push({ from: column, to: target, color: colors[target] });
    }

    const bottom: GraphEdge[] = [];
    lanes.forEach((sha, i) => {
      if (sha === null) {
        return;
      }
      if (i === column) {
        bottom.push({ from: column, to: column, color });
      } else if (top.some((edge) => edge.from === i && edge.to === i)) {
        bottom.push({ from: i, to: i, color: colors[i] });
      }
    });
    bottom.push(...extra);

    // Close the gaps that ended branches leave, so lanes to their right move over (the bottom edges bend
    // across) and the graph stays as narrow as the branches in progress. Without this an old branch keeps
    // its lane far to the right with empty lanes before it, however many branches ended.
    const moved = new Map<number, number>();
    lanes.forEach((sha, i) => {
      if (sha !== null) {
        moved.set(i, moved.size);
      }
    });
    for (const edge of bottom) {
      edge.to = moved.get(edge.to) ?? edge.to;
    }
    const kept = lanes.flatMap((sha, i) => (sha === null ? [] : [i]));
    const keptColors = kept.map((i) => colors[i]);
    lanes.splice(0, lanes.length, ...kept.map((i) => lanes[i]));
    colors.splice(0, colors.length, ...keptColors);

    rows.push({
      sha: commit.sha,
      column,
      color,
      isMerge: commit.parents.length > 1,
      top,
      bottom,
      width: Math.max(widthBefore, lanes.length, column + 1),
    });
  }

  return { rows, state: { lanes, colors, nextColor } };
}

/**
 * The rows of a graph whose merges are collapsed. Git already listed first-parent history only
 * (`--first-parent`), so a collapsed merge keeps just its first parent; a merge the person expanded
 * is followed by the commits of its merged-in side, loaded separately, in which merges are again
 * collapsed unless expanded too.
 */
export function withMergeSides<T extends GraphLaneCommit>(
  commits: readonly T[],
  expanded: ReadonlySet<string>,
  sides: ReadonlyMap<string, readonly T[]>,
): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  const emit = (list: readonly T[]): void => {
    for (const commit of list) {
      if (seen.has(commit.sha)) {
        continue;
      }
      seen.add(commit.sha);
      const side = commit.parents.length > 1 && expanded.has(commit.sha) ? sides.get(commit.sha) : undefined;
      out.push(commit.parents.length > 1 && !side ? { ...commit, parents: commit.parents.slice(0, 1) } : commit);
      if (side) {
        emit(side);
      }
    }
  };
  emit(commits);
  return out;
}

/** `collapsed` draws `+` in the node; `expanded` draws `−` so the merge can be collapsed again. */
export type MergeNodeMarker = 'none' | 'collapsed' | 'expanded';

export function mergeNodeMarker(
  parentCount: number,
  collapseEnabled: boolean,
  expanded: boolean,
): MergeNodeMarker {
  if (!collapseEnabled || parentCount < 2) {
    return 'none';
  }
  return expanded ? 'expanded' : 'collapsed';
}
