import type { ExtensionContext } from 'vscode';

// Renamed from graph.filterByRepo so filters written by the old follow-HEAD default are dropped.
const FILTER_KEY = 'gitCheckout.graph.filter';
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
