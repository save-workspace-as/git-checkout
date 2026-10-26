import type { GraphCommitDto, GraphRefDto } from '../../shared/graph/graphProtocol';
import {
    assertStashSelector,
    isStashSelector,
    stashDropOrder,
    stashIndex,
    type StashEntryDto,
} from '../../shared/stash/stashProtocol';

const FULL_SHA = /^[0-9a-f]{40}$/i;

export const STASH_LIST_ARGS = ['stash', 'list', '-z', '--format=%gd%x00%H%x00%gs'];

export { assertStashSelector, isStashSelector, stashDropOrder, stashIndex };

const STASH_REF_TOKEN = /^stash@\{.+\}$/;

/**
 * `git stash list` is newest-first, so row 0 is `stash@{0}`.
 * `%gd` is that index unless a date format rewrites it (`stash@{2 minutes ago}`).
 */
function canonicalStashSelector(raw: string, position: number): string | null {
  if (!STASH_REF_TOKEN.test(raw)) {
    return null;
  }
  if (isStashSelector(raw) && stashIndex(raw) === position) {
    return raw;
  }
  return `stash@{${position}}`;
}

export function parseStashList(output: string): StashEntryDto[] {
  const parts = output.split('\0');
  const entries: StashEntryDto[] = [];
  let position = 0;
  for (let i = 0; i + 2 < parts.length; i += 3) {
    const raw = parts[i] ?? '';
    const sha = parts[i + 1] ?? '';
    const message = parts[i + 2] ?? '';
    const selector = FULL_SHA.test(sha) ? canonicalStashSelector(raw, position) : null;
    if (STASH_REF_TOKEN.test(raw)) {
      position += 1;
    }
    if (!selector) {
      continue;
    }
    entries.push({
      index: stashIndex(selector),
      selector,
      sha,
      message,
    });
  }
  return entries;
}

/** Labels stash commits as `stash@{n}` and replaces the bare `refs/stash` decoration. */
export function labelStashCommits(
  commits: readonly GraphCommitDto[],
  entries: readonly StashEntryDto[],
): GraphCommitDto[] {
  if (entries.length === 0) {
    return [...commits];
  }
  const bySha = new Map<string, string[]>();
  for (const entry of entries) {
    const selectors = bySha.get(entry.sha) ?? [];
    if (!selectors.includes(entry.selector)) {
      selectors.push(entry.selector);
      bySha.set(entry.sha, selectors);
    }
  }
  return commits.map((commit) => {
    const selectors = bySha.get(commit.sha);
    if (!selectors || selectors.length === 0) {
      return commit;
    }
    const refs: GraphRefDto[] = commit.refs.filter(
      (ref) => !(ref.kind === 'stash' && (ref.name === 'stash' || selectors.includes(ref.name))),
    );
    for (const name of selectors) {
      refs.push({ kind: 'stash', name });
    }
    return { ...commit, refs };
  });
}
