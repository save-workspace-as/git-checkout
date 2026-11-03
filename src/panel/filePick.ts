/**
 * Which row of a native file list a selection event means as a pick, if any. Of a multi-selection it is the row that was
 * just added. While the list has just been given new rows (`quiet`) no event is a pick: VS Code restores the selection of a
 * row whose id is back in the list, for example the same path in the next commit, and that is not a click.
 */
export function pickFromSelection<N extends { key: string; kind: string }>(
  selection: readonly N[],
  previous: ReadonlySet<string>,
  selectedKey: string | undefined,
  quiet: boolean,
): { target?: N; previous: Set<string> } {
  const files = selection.filter((node) => node.kind === 'file');
  const next = new Set(files.map((node) => node.key));
  if (quiet) {
    return { previous: next };
  }
  const added = files.filter((node) => !previous.has(node.key));
  const target = added[added.length - 1];
  return target && target.key !== selectedKey ? { target, previous: next } : { previous: next };
}

/** How long after new rows arrive a selection event is taken for VS Code restoring the selection, not for a click. */
export const SELECTION_QUIET_MS = 800;
