import type { GitCli } from '../../core/gitCli';
import { createLogger } from '../../log';
import type { RefsSnapshotDto } from '../../shared/branches/refsProtocol';

const log = createLogger('branch-filter');

/** Which branches the sidebar lists: all, those with your commits, those changed lately, or those left alone. */
export type BranchFilter = 'all' | 'mine' | 'active' | 'stale';

/** A branch is stale when its last commit is older than this: three months. */
export const STALE_AFTER_SECONDS = 90 * 24 * 60 * 60;

/** More branches than this are not each checked for your commits; the last commit of each decides instead. */
const MAX_COMMIT_CHECKS = 300;
const PARALLEL_CHECKS = 8;

export interface BranchActivity {
  /** The full name, such as `refs/heads/topic` or `refs/remotes/origin/topic`. */
  ref: string;
  /** When the last commit of the branch was made, in seconds since 1970. */
  time: number;
  /** Whether you made a commit on it that the default branch does not have. */
  mine: boolean;
}

const TIP_FORMAT = '%(refname:short)%00%(committerdate:unix)%00%(authoremail)%00%(refname)';

function sameEmail(a: string, b: string): boolean {
  return a.replace(/^<|>$/g, '').toLowerCase() === b.toLowerCase();
}

/** The branch the others grow from, as a short name such as `origin/main`, when the repository has one. */
async function defaultBranch(cli: GitCli, names: ReadonlySet<string>): Promise<string | undefined> {
  try {
    const result = await cli.execRead(['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']);
    const name = result.stdout.trim();
    if (name) {
      return name;
    }
  } catch (error) {
    // A repository without an origin, or whose origin has no HEAD, has no such reference.
    log.debug('no origin/HEAD to find the default branch', error);
  }
  return ['main', 'master'].find((name) => names.has(name));
}

/**
 * When each branch last changed and whether it is yours. Branches that hold commits of yours that the default branch
 * lacks are yours; the default branch itself never is. Without a default branch, the author of the last commit decides.
 */
export async function loadBranchActivity(cli: GitCli, filter: BranchFilter): Promise<Map<string, BranchActivity>> {
  const activity = new Map<string, BranchActivity>();
  if (filter === 'all') {
    return activity;
  }
  const tips = await cli.execRead(['for-each-ref', 'refs/heads/', 'refs/remotes/', `--format=${TIP_FORMAT}`]);
  const rows = tips.stdout
    .split('\n')
    .map((line) => line.split('\0'))
    .filter((cells) => cells.length >= 4 && cells[0]);
  const times = new Map(rows.map(([name, time]) => [name, Number(time) || 0]));
  const fullNames = new Map(rows.map(([name, , , full]) => [name, full]));
  if (filter !== 'mine') {
    for (const [name, time] of times) {
      activity.set(name, { ref: fullNames.get(name) ?? name, time, mine: false });
    }
    return activity;
  }

  let me = '';
  try {
    me = (await cli.execRead(['config', 'user.email'])).stdout.trim();
  } catch (error) {
    // No user.email configured: nothing can be told to be yours.
    log.debug('no user.email to tell which branches are yours', error);
  }
  if (!me) {
    for (const [name, time] of times) {
      activity.set(name, { ref: fullNames.get(name) ?? name, time, mine: false });
    }
    return activity;
  }
  const base = await defaultBranch(cli, new Set(times.keys()));
  const baseNames = new Set(base ? [base, base.replace(/^origin\//, '')] : []);
  const candidates = rows.filter(([name]) => !baseNames.has(name) && !name.endsWith('/HEAD'));
  const checked = base && candidates.length <= MAX_COMMIT_CHECKS;
  const isMine = async ([name, , author]: string[]): Promise<boolean> => {
    if (!checked) {
      return sameEmail(author, me);
    }
    try {
      const result = await cli.execRead(['rev-list', '--count', '--max-count=1', '--fixed-strings', '--regexp-ignore-case', `--author=<${me}>`, name, '--not', base]);
      return result.stdout.trim() === '1';
    } catch (error) {
      log.warn(`could not look for your commits on ${name}`, error);
      return false;
    }
  };
  const mine = new Map<string, boolean>();
  for (let start = 0; start < candidates.length; start += PARALLEL_CHECKS) {
    const batch = candidates.slice(start, start + PARALLEL_CHECKS);
    const results = await Promise.all(batch.map(isMine));
    batch.forEach(([name], index) => mine.set(name, results[index]));
  }
  for (const [name, time] of times) {
    activity.set(name, { ref: fullNames.get(name) ?? name, time, mine: mine.get(name) ?? false });
  }
  return activity;
}

function keeps(filter: BranchFilter, known: BranchActivity | undefined, nowSeconds: number): boolean {
  if (filter === 'all') {
    return true;
  }
  if (!known) {
    return false;
  }
  switch (filter) {
    case 'mine':
      return known.mine;
    case 'active':
      return nowSeconds - known.time <= STALE_AFTER_SECONDS;
    case 'stale':
      return nowSeconds - known.time > STALE_AFTER_SECONDS;
  }
}

/** The snapshot with only the branches the filter keeps; the checked-out branch always stays. */
export function filterBranches(snapshot: RefsSnapshotDto, filter: BranchFilter, activity: ReadonlyMap<string, BranchActivity>, nowSeconds: number): RefsSnapshotDto {
  if (filter === 'all') {
    return snapshot;
  }
  return {
    ...snapshot,
    branches: snapshot.branches.filter((branch) => branch.isHead || keeps(filter, activity.get(branch.name), nowSeconds)),
    remoteBranches: snapshot.remoteBranches.filter((branch) => keeps(filter, activity.get(branch.name), nowSeconds)),
  };
}

/** Most refs the graph leaves out by name: each is two arguments to Git, and Windows allows about 32 000 characters. */
export const MAX_FILTERED_REFS = 300;

/** The full names of the branches the filter leaves out, for the graph to hide; the checked-out branch is never one. */
export function refsFilteredOut(filter: BranchFilter, activity: ReadonlyMap<string, BranchActivity>, nowSeconds: number, headName: string | null): string[] {
  const out: string[] = [];
  for (const [name, known] of activity) {
    if (name !== headName && !name.endsWith('/HEAD') && !keeps(filter, known, nowSeconds)) {
      out.push(known.ref);
    }
  }
  return out;
}
