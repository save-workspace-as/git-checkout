export type BisectMark = 'good' | 'bad' | 'skip';

/** Bisect session mirrored from `.git` so a reload can restore the toolbar and graph. */
export interface BisectStateDto {
  active: boolean;
  /** Commit git currently has checked out for testing. */
  currentSha: string | null;
  /** Set once `git bisect` has named the first bad commit. */
  firstBadSha: string | null;
  good: string[];
  bad: string[];
  skip: string[];
  summary: string;
}

export const IDLE_BISECT_STATE: BisectStateDto = {
  active: false,
  currentSha: null,
  firstBadSha: null,
  good: [],
  bad: [],
  skip: [],
  summary: '',
};

/** Commit the graph should select: the revision under test, which is HEAD after start. */
export function bisectCheckoutSha(state: BisectStateDto): string | null {
  if (!state.active) {
    return null;
  }
  return state.currentSha;
}

/** Bad wins over skip and good when a commit was marked more than once. */
export function bisectMarkForSha(state: BisectStateDto, sha: string): BisectMark | null {
  if (state.bad.includes(sha)) {
    return 'bad';
  }
  if (state.skip.includes(sha)) {
    return 'skip';
  }
  if (state.good.includes(sha)) {
    return 'good';
  }
  return null;
}

/** SHA from a graph `webview/context` invocation; title-bar actions pass no commit. */
export function bisectCommitSha(arg: unknown): string | undefined {
  if (!arg || typeof arg !== 'object') {
    return undefined;
  }
  const record = arg as { webviewSection?: unknown; sha?: unknown };
  if (record.webviewSection !== 'commit' || typeof record.sha !== 'string') {
    return undefined;
  }
  const sha = record.sha.trim();
  return sha.length > 0 ? sha : undefined;
}
