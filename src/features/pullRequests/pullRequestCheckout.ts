import { createLogger } from '../../log';
import { pullRequestBranch } from '../../shared/pullRequests/pullRequests';

const log = createLogger('pull-requests');

/** The git calls a pull request checkout makes; the tests give a real repository's. */
export interface PullRequestGit {
  execRead(args: string[], options?: { showErrorToast?: boolean }): Promise<{ stdout: string }>;
  execWrite(args: string[], options?: { network?: boolean; showErrorToast?: boolean }): Promise<{ stdout: string }>;
}

export type PullRequestBranchResult =
  /** The local branch is at the pull request's head. */
  | { kind: 'ready'; branch: string; sha: string }
  /** The local branch has commits the pull request does not, so it would be lost by moving it. */
  | { kind: 'diverged'; branch: string; sha: string };

/** The commit the pull request is at on GitHub, whoever's fork it comes from: GitHub keeps it at `refs/pull/<n>/head`. */
export async function fetchPullRequestHead(git: PullRequestGit, remote: string, number: number): Promise<string> {
  await git.execWrite(['fetch', '--no-tags', remote, `pull/${number}/head`], { network: true });
  return (await git.execRead(['rev-parse', 'FETCH_HEAD^{commit}'])).stdout.trim();
}

async function branchExists(git: PullRequestGit, branch: string): Promise<boolean> {
  return git.execRead(['rev-parse', '--verify', '-q', `refs/heads/${branch}`], { showErrorToast: false }).then(
    () => true,
    (error: unknown) => {
      // Exit status 1 means there is no such branch, which is the answer.
      log.debug('no such branch', error);
      return false;
    },
  );
}

async function isAncestor(git: PullRequestGit, older: string, newer: string): Promise<boolean> {
  return git.execRead(['merge-base', '--is-ancestor', older, newer], { showErrorToast: false }).then(
    () => true,
    (error: unknown) => {
      // Exit status 1 means it is not an ancestor.
      log.debug('not an ancestor', error);
      return false;
    },
  );
}

/**
 * Brings the pull request's branch up to date without leaving the current one: a new `pr/<n>` at its head, or the
 * existing one moved forward. A branch that has commits of its own is left alone and reported, so nothing is lost.
 */
export async function preparePullRequestBranch(git: PullRequestGit, remote: string, number: number): Promise<PullRequestBranchResult> {
  const sha = await fetchPullRequestHead(git, remote, number);
  const branch = pullRequestBranch(number);
  if (!(await branchExists(git, branch))) {
    await git.execWrite(['branch', branch, sha]);
    return { kind: 'ready', branch, sha };
  }
  if (await isAncestor(git, branch, sha)) {
    await moveBranch(git, branch, sha, false);
    return { kind: 'ready', branch, sha };
  }
  return { kind: 'diverged', branch, sha };
}

async function currentBranch(git: PullRequestGit): Promise<string> {
  return git.execRead(['symbolic-ref', '--short', '-q', 'HEAD'], { showErrorToast: false }).then(
    (result) => result.stdout.trim(),
    (error: unknown) => {
      // A detached HEAD has no branch.
      log.debug('no current branch', error);
      return '';
    },
  );
}

/** Git will not move the checked-out branch with `branch -f`, so that one moves with the working tree, keeping local changes. */
async function moveBranch(git: PullRequestGit, branch: string, sha: string, discardCommits: boolean): Promise<void> {
  if ((await currentBranch(git)) === branch) {
    await git.execWrite(discardCommits ? ['reset', '--keep', sha] : ['merge', '--ff-only', sha]);
  } else {
    await git.execWrite(['branch', '-f', branch, sha]);
  }
}

/** Moves the pull request's branch to its head, whatever the branch had, after the person agreed. */
export async function resetPullRequestBranch(git: PullRequestGit, branch: string, sha: string): Promise<void> {
  await moveBranch(git, branch, sha, true);
}

/** Checks out the pull request's branch; a branch checked out in a worktree is moved by that checkout instead. */
export async function checkoutPullRequestBranch(git: PullRequestGit, branch: string): Promise<void> {
  await git.execWrite(['checkout', branch]);
}
