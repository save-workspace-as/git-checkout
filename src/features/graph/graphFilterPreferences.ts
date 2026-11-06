import type { ExtensionContext } from 'vscode';

// Renamed from graph.filterByRepo so filters written by the old follow-HEAD default are dropped.
const FILTER_KEY = 'gitCheckout.graph.filter';
const HIDDEN_REFS_KEY = 'gitCheckout.graph.hiddenRefs';
const COLLAPSE_MERGES_KEY = 'gitCheckout.graph.collapseMerges';

type FilterMap = Record<string, string>;

export function getFilterRef(context: ExtensionContext, repoRoot: string): string | undefined {
  const map = context.workspaceState.get<FilterMap>(FILTER_KEY, {});
  return map[repoRoot];
}

export function setFilterRef(
  context: ExtensionContext,
  repoRoot: string,
  filterRef: string,
): void {
  const map = { ...context.workspaceState.get<FilterMap>(FILTER_KEY, {}) };
  map[repoRoot] = filterRef;
  void context.workspaceState.update(FILTER_KEY, map);
}

export function getCollapseMerges(context: ExtensionContext): boolean {
  return context.workspaceState.get<boolean>(COLLAPSE_MERGES_KEY, false);
}

export function setCollapseMerges(context: ExtensionContext, enabled: boolean): void {
  void context.workspaceState.update(COLLAPSE_MERGES_KEY, enabled);
}

/** The full names of the refs a person hid from the graph of `repoRoot`, such as `refs/heads/topic`. */
export function getHiddenRefs(context: ExtensionContext, repoRoot: string): string[] {
  return context.workspaceState.get<Record<string, string[]>>(HIDDEN_REFS_KEY, {})[repoRoot] ?? [];
}

export function setHiddenRefs(context: ExtensionContext, repoRoot: string, refs: readonly string[]): void {
  const map = { ...context.workspaceState.get<Record<string, string[]>>(HIDDEN_REFS_KEY, {}) };
  if (refs.length > 0) {
    map[repoRoot] = [...refs];
  } else {
    delete map[repoRoot];
  }
  void context.workspaceState.update(HIDDEN_REFS_KEY, map);
}
