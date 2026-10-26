export type FindStep = { kind: 'goto'; index: number } | { kind: 'wait' } | { kind: 'none' };

/**
 * Where Enter (`delta` 1) or Shift+Enter (-1) goes among `count` matches found so far. Past the
 * last match it wraps to the first once the search has covered all history, and waits for more
 * results until then.
 */
export function nextFindStep(current: number, count: number, done: boolean, delta: 1 | -1): FindStep {
  if (count === 0) {
    return done ? { kind: 'none' } : { kind: 'wait' };
  }
  if (delta === 1) {
    if (current + 1 < count) {
      return { kind: 'goto', index: current + 1 };
    }
    return done ? { kind: 'goto', index: 0 } : { kind: 'wait' };
  }
  // Going back from the first match wraps to the last found so far, as there is nothing earlier to wait for.
  return { kind: 'goto', index: current > 0 ? current - 1 : count - 1 };
}

/**
 * The first match at or after the current row, where `positions` gives the row of each match that
 * is loaded. Matches that are not loaded lie beyond every loaded row. -1 when none follows.
 */
export function firstMatchFrom(
  matches: readonly string[],
  positions: ReadonlyMap<string, number>,
  currentRow: number,
): number {
  const start = Math.max(0, currentRow);
  return matches.findIndex((sha) => (positions.get(sha) ?? Number.POSITIVE_INFINITY) >= start);
}
