export const GRAPH_ROW_HEIGHT = 22;

export interface VirtualWindow {
  start: number;
  end: number;
  offsetY: number;
  totalHeight: number;
}

export function computeVirtualWindow(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
  buffer = 10,
): VirtualWindow {
  const totalHeight = rowCount * GRAPH_ROW_HEIGHT;
  const start = Math.max(0, Math.floor(scrollTop / GRAPH_ROW_HEIGHT) - buffer);
  const visibleCount = Math.ceil(viewportHeight / GRAPH_ROW_HEIGHT) + buffer * 2;
  const end = Math.min(rowCount, start + visibleCount);
  const offsetY = start * GRAPH_ROW_HEIGHT;
  return { start, end, offsetY, totalHeight };
}
