import type { GitHubRepository } from '../history/githubReferences';
import { isFromFork, type PullRequestDto } from './pullRequests';

/** Pull requests that build on one another, bottom (merged first) to top. */
export interface PullRequestChain {
  /** The branch the bottom pull request merges into. */
  base: string;
  pulls: PullRequestDto[];
}

/**
 * The stacks among open pull requests, read from their branches: a pull request whose target is the branch of another is
 * on top of it. This is how a stack looks to Git, so it finds them whether or not GitHub grouped them. A chain ends where a
 * pull request has more than one on top of it, because a stack has one pull request on top of another; each of those
 * starts a chain of its own. Pull requests from forks are left out, as stacks live in one repository. Only chains of two or
 * more are returned, the one changed most recently first.
 */
export function pullRequestChains(pulls: readonly PullRequestDto[], repo: GitHubRepository): PullRequestChain[] {
  const own = pulls.filter((pull) => pull.headRepository !== null && !isFromFork(pull, repo));
  const byHead = new Map<string, PullRequestDto>();
  for (const pull of own) {
    if (!byHead.has(pull.headRef)) {
      byHead.set(pull.headRef, pull);
    }
  }
  const parentOf = (pull: PullRequestDto): PullRequestDto | undefined => {
    const parent = byHead.get(pull.baseRef);
    return parent && parent !== pull ? parent : undefined;
  };
  const above = new Map<PullRequestDto, PullRequestDto[]>();
  for (const pull of own) {
    const parent = parentOf(pull);
    if (parent) {
      above.set(parent, [...(above.get(parent) ?? []), pull].sort((a, b) => a.number - b.number));
    }
  }
  // A chain starts at a pull request that is on nothing, or on one with several on top of it.
  const starts = own.filter((pull) => {
    const parent = parentOf(pull);
    return !parent || (above.get(parent)?.length ?? 0) > 1;
  });
  const chains: PullRequestChain[] = [];
  const seen = new Set<PullRequestDto>();
  for (const start of starts) {
    const chain: PullRequestDto[] = [];
    for (let at: PullRequestDto | undefined = start; at && !seen.has(at); ) {
      seen.add(at);
      chain.push(at);
      const next: PullRequestDto[] = above.get(at) ?? [];
      at = next.length === 1 ? next[0] : undefined;
    }
    if (chain.length > 1) {
      chains.push({ base: start.baseRef, pulls: chain });
    }
  }
  const newest = (chain: PullRequestChain): string => chain.pulls.reduce((latest, pull) => (pull.updatedAt > latest ? pull.updatedAt : latest), '');
  return chains.sort((a, b) => newest(b).localeCompare(newest(a)));
}
