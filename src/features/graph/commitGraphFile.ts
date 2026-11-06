/** Repositories this big, in KiB of objects, are the ones where the commit-graph file pays off. */
export const LARGE_REPOSITORY_KIB = 100_000;

/** The bytes of a commit-graph file that name its parts: the header, and the table of its chunks. */
export const COMMIT_GRAPH_HEADER_BYTES = 8 + 12 * 16;

/**
 * Whether a commit-graph file has the Bloom filters of changed paths (the `BIDX` chunk), which make history of a file
 * and blame several times faster. `header` is the start of the file: 8 bytes, then 12 bytes for each chunk, the last
 * one marking the end.
 */
export function commitGraphHasChangedPaths(header: Uint8Array): boolean {
  if (header.length < 8 || String.fromCharCode(...header.subarray(0, 4)) !== 'CGPH') {
    return false;
  }
  const chunks = header[6];
  for (let index = 0; index < chunks; index++) {
    const at = 8 + index * 12;
    if (at + 4 > header.length) {
      return false;
    }
    if (String.fromCharCode(...header.subarray(at, at + 4)) === 'BIDX') {
      return true;
    }
  }
  return false;
}

/** The size of all objects, loose and packed, from `git count-objects -v`, in KiB. */
export function objectsSizeKiB(countObjects: string): number {
  const value = (key: string): number => Number(new RegExp(`^${key}: (\\d+)$`, 'm').exec(countObjects)?.[1] ?? 0);
  return value('size') + value('size-pack');
}

/** What the repository has of a commit-graph file: nothing, a chain of files (left alone), or one file. */
export type CommitGraphState = { kind: 'none' } | { kind: 'chain' } | { kind: 'file'; header: Uint8Array };

/** Whether to write the commit-graph file with changed paths: a large repository that has none, or one without those filters. */
export function wantsCommitGraph(sizeKiB: number, state: CommitGraphState, largeKiB = LARGE_REPOSITORY_KIB): boolean {
  if (sizeKiB < largeKiB || state.kind === 'chain') {
    return false;
  }
  return state.kind === 'none' || !commitGraphHasChangedPaths(state.header);
}
