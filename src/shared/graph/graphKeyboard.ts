import { GRAPH_ROW_HEIGHT } from './graphVirtualWindow';

/** Height of the sticky column header; rows start below it. */
export const GRAPH_HEADER_HEIGHT = 22;

const NAVIGATION_KEYS = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'PageDown', 'PageUp'] as const;
export type GraphNavigationKey = (typeof NAVIGATION_KEYS)[number];

export function isGraphNavigationKey(key: string): key is GraphNavigationKey {
  return (NAVIGATION_KEYS as readonly string[]).includes(key);
}

/** Row index a navigation key moves to from `current` (-1 when no row is current), or -1 for an empty list. */
export function graphNavigationTarget(
  key: GraphNavigationKey,
  current: number,
  rowCount: number,
  pageRows: number,
): number {
  if (rowCount === 0) {
    return -1;
  }
  const last = rowCount - 1;
  const clamp = (index: number): number => Math.min(last, Math.max(0, index));
  switch (key) {
    case 'ArrowDown':
      return clamp(current + 1);
    case 'ArrowUp':
      return clamp(current < 0 ? 0 : current - 1);
    case 'PageDown':
      return clamp(current + Math.max(1, pageRows));
    case 'PageUp':
      return clamp(current - Math.max(1, pageRows));
    case 'Home':
      return 0;
    case 'End':
      return last;
  }
}

/** Inclusive row indexes between the anchor and the target, in either direction. */
export function graphSelectionRange(anchor: number, target: number): [number, number] {
  return [Math.min(anchor, target), Math.max(anchor, target)];
}

/** Scroll position that shows row `index` in full below the sticky header, moving as little as needed. */
export function scrollTopToReveal(index: number, scrollTop: number, viewportHeight: number): number {
  const rowTop = GRAPH_HEADER_HEIGHT + index * GRAPH_ROW_HEIGHT;
  if (rowTop - GRAPH_HEADER_HEIGHT < scrollTop) {
    return Math.max(0, rowTop - GRAPH_HEADER_HEIGHT);
  }
  const overflow = rowTop + GRAPH_ROW_HEIGHT - (scrollTop + viewportHeight);
  return overflow > 0 ? scrollTop + overflow : scrollTop;
}
