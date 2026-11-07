import type { GitCli } from '../../core/gitCli';
import { createLogger } from '../../log';
import type { GitHubRepository } from '../../shared/history/githubReferences';
import {
  createPullRequest, createStack, findOpenPullRequest, fetchRestTransport, GitHubRestError, setPullRequestBase,
  type CreatedPullRequest, type PullRequestStack, type RestTransport,
} from './githubRestClient';
import type { StackPlan } from './pullRequestStackForm';

const log = createLogger('pull-request-stack');

export interface StackOutcome {
  /** The pull requests, bottom first. */
  pullRequests: (CreatedPullRequest & { branch: string })[];
  stack?: PullRequestStack;
  /** Why the pull requests were not grouped, when they were meant to be. */
  stackProblem?: string;
}

/** Makes the branch of each layer that is new, at the commit that ends the layer; one that is there already stays. */
async function makeBranches(cli: GitCli, plan: StackPlan): Promise<void> {
  for (const layer of plan.layers.filter((entry) => entry.created)) {
    const ref = `refs/heads/${layer.branch}`;
    let at: string | undefined;
    try {
      at = (await cli.execRead(['rev-parse', '--verify', '--quiet', ref])).stdout.trim() || undefined;
    } catch (error) {
      // The branch is not there yet, which is the usual case; a branch left by an earlier try is checked below.
      log.debug(`${layer.branch} does not exist yet`, error);
    }
    if (at === undefined) {
      await cli.execWrite(['branch', '--', layer.branch, layer.sha]);
    } else if (at !== layer.sha) {
      throw new Error(`The branch '${layer.branch}' exists and is not at the commit chosen for it.`);
    }
  }
}

/**
 * Makes the plan's pull requests: the new branches, one push of every branch, then each pull request from the bottom up,
 * and the stack that groups them. Running it again after a failure carries on, because a branch or an open pull request
 * that is there already is used as it is (a pull request with the wrong base gets the right one).
 */
export async function createPullRequests(
  cli: GitCli,
  remote: string,
  repo: GitHubRepository,
  token: string,
  plan: StackPlan,
  transport: RestTransport = fetchRestTransport,
): Promise<StackOutcome> {
  await makeBranches(cli, plan);
  await cli.execWrite(['push', '--atomic', '--set-upstream', remote, ...plan.layers.map((layer) => `refs/heads/${layer.branch}`)], { network: true });

  const pullRequests: StackOutcome['pullRequests'] = [];
  for (const layer of plan.layers) {
    let pull = await findOpenPullRequest(repo, token, layer.branch, transport);
    if (!pull) {
      pull = await createPullRequest(repo, token, { title: layer.title, head: layer.branch, base: layer.base, body: layer.body, draft: plan.draft }, transport);
    } else if (pull.base !== layer.base) {
      pull = await setPullRequestBase(repo, token, pull.number, layer.base, transport);
    }
    pullRequests.push({ ...pull, branch: layer.branch });
  }

  const outcome: StackOutcome = { pullRequests };
  if (plan.link && pullRequests.length > 1) {
    try {
      outcome.stack = await createStack(repo, token, pullRequests.map((pull) => pull.number), transport);
    } catch (error) {
      if (!(error instanceof GitHubRestError)) {
        throw error;
      }
      // The pull requests are made and chained by their bases; only the grouping is missing, which the person is told.
      log.warn('could not group the pull requests as a stack', error);
      outcome.stackProblem = error.message;
    }
  }
  return outcome;
}
