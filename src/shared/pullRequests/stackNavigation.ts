import { pullRequestBranch, type PullRequestDto } from './pullRequests';
import type { PullRequestChain } from './pullRequestStacks';

export type StackMove = 'up' | 'down' | 'top' | 'bottom';

/** Where a branch is in the stacks: the one whose pull request is from it (or from `pr/<n>`), and its place, counting from 0. */
export function locateLayer(chains: readonly PullRequestChain[], branch: string): { chain: PullRequestChain; index: number } | undefined {
  for (const chain of chains) {
    const index = chain.pulls.findIndex((pull) => pull.headRef === branch || pullRequestBranch(pull.number) === branch);
    if (index >= 0) {
      return { chain, index };
    }
  }
  return undefined;
}

/** The layer a move from `index` ends at: up is toward the newest pull request. Undefined when it would not move. */
export function moveInStack(chain: PullRequestChain, index: number, move: StackMove): PullRequestDto | undefined {
  const last = chain.pulls.length - 1;
  const target = move === 'up' ? index + 1 : move === 'down' ? index - 1 : move === 'top' ? last : 0;
  return target === index || target < 0 || target > last ? undefined : chain.pulls[target];
}
