const QUOTED_ID = /['"](gitCheckout\.[A-Za-z0-9.]+)['"]/g;

/** Panel viewType and context keys referenced by e2e tests. They are not contributed commands. */
export const E2E_VIEW_TYPES = new Set(['gitCheckout.main', 'gitCheckout.panelOpen']);

/** VS Code makes a `<viewId>.focus` command for every view; it is not declared in the manifest. */
const VIEW_FOCUS_COMMAND = /\.focus$/;

/** Command ids quoted in an e2e source file, excluding panel view types, context keys and view focus commands. */
export function commandIdsInE2eSource(source: string): string[] {
  const ids = new Set<string>();
  for (const match of source.matchAll(QUOTED_ID)) {
    const id = match[1];
    if (!E2E_VIEW_TYPES.has(id) && !VIEW_FOCUS_COMMAND.test(id)) {
      ids.add(id);
    }
  }
  return [...ids].sort();
}
