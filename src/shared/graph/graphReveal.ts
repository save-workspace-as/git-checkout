export type RevealStep = 'found' | 'loadMore' | 'notFound';

/** Upper bound on extra pages fetched while looking for a revealed commit. */
export const REVEAL_MAX_PAGES = 25;

export function revealStep(
  loadedShas: ReadonlySet<string>,
  sha: string,
  hasMore: boolean,
  pagesLoaded: number,
  maxPages = REVEAL_MAX_PAGES,
): RevealStep {
  if (loadedShas.has(sha)) {
    return 'found';
  }
  return hasMore && pagesLoaded < maxPages ? 'loadMore' : 'notFound';
}
