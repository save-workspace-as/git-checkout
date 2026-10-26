import { coalesced } from '../../core/coalesced';
import type { CommitGraphService } from './commitGraphService';

/** A refresh reloads as many commits as the person has scrolled through, up to this many. */
export const MAX_REFRESH_DEPTH = 2000;

/**
 * Reloads the graph from the top as deep as it was loaded, so the view keeps its place.
 *
 * - It reloads only when a ref or HEAD moved. Most refreshes come from changes the graph does not show
 *   (a saved file, the index), and reloading the whole loaded depth for each of them was the costly part.
 *   `force` reloads anyway, for the Refresh command.
 * - Refreshes never overlap: each one resets the graph's paging, and a second one started in the middle
 *   would leave the first with duplicate rows and itself see nothing loaded (and start over at the top).
 *   A refresh asked for while one runs waits and runs once after it.
 */
export function graphRefresher(
  graphService: () => Pick<CommitGraphService, 'loadedCount' | 'reset' | 'refsFingerprint'>,
  repoRoot: () => string | null,
  send: (keepDepth: number) => Promise<void>,
): (force?: boolean) => Promise<void> {
  const shown = new Map<string, string>();
  let forced = false;
  const run = coalesced(async () => {
    const force = forced;
    forced = false;
    const root = repoRoot();
    if (!root) {
      return;
    }
    const service = graphService();
    const fingerprint = await service.refsFingerprint(root);
    if (!force && shown.get(root) === fingerprint) {
      return;
    }
    shown.set(root, fingerprint);
    const depth = service.loadedCount(root);
    service.reset(root);
    await send(Math.min(depth, MAX_REFRESH_DEPTH));
  });
  return (force = false) => {
    forced ||= force;
    return run();
  };
}
