import type { GitCli } from '../../core/gitCli';
import { revisionArg } from '../../core/gitRevision';
import type { StackCommit } from '../../shared/pullRequests/stackLayers';
import { findBaseBranch } from './branchChanges';

/** Most commits offered as layers; a branch with more is too long to read as one stack. */
export const MAX_STACK_COMMITS = 50;

export type StackCommits =
  | { kind: 'commits'; base: string; commits: StackCommit[] }
  /** A merge commit sits between the base and the branch: where a layer would end is not clear. */
  | { kind: 'merges'; base: string }
  | { kind: 'tooMany'; base: string; count: number }
  | { kind: 'noBase' };

/** The branch a base such as `origin/main` is on the remote: `main`. */
export function baseBranchName(base: string, remote: string): string {
  return base.startsWith(`${remote}/`) ? base.slice(remote.length + 1) : base;
}

/** The commits a branch has beyond its base, oldest first, each with the other local branches that end at it. */
export async function loadStackCommits(cli: GitCli, branch: string): Promise<StackCommits> {
  const name = revisionArg(branch);
  const base = await findBaseBranch(cli, name);
  if (!base) {
    return { kind: 'noBase' };
  }
  const range = `${base}..${name}`;
  const counts = (await cli.execRead(['rev-list', '--count', range])).stdout.trim();
  const count = Number(counts) || 0;
  if (count > MAX_STACK_COMMITS) {
    return { kind: 'tooMany', base, count };
  }
  if ((Number((await cli.execRead(['rev-list', '--merges', '--count', range])).stdout.trim()) || 0) > 0) {
    return { kind: 'merges', base };
  }
  const listing = (await cli.execRead(['log', '--reverse', '--format=%H%x00%s%x00%b%x01', range])).stdout;
  const heads = (await cli.execRead(['for-each-ref', '--format=%(objectname)%00%(refname:short)', 'refs/heads'])).stdout;
  const branchesAt = new Map<string, string[]>();
  for (const line of heads.split('\n')) {
    const [sha, ref] = line.split('\0');
    if (sha && ref && ref !== name) {
      branchesAt.set(sha, [...(branchesAt.get(sha) ?? []), ref]);
    }
  }
  const commits = listing
    .split('\x01')
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim() !== '')
    .map((record): StackCommit => {
      const [sha = '', subject = '', body = ''] = record.split('\0');
      return { sha, subject: subject.trim(), body: body.trim(), branches: branchesAt.get(sha) ?? [] };
    });
  return { kind: 'commits', base, commits };
}
