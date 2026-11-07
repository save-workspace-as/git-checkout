import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { commitFile } from './graphMenu';
import { git, repoRoot, resetToRepository, type bindExtension } from './harness';

type Api = ReturnType<typeof bindExtension>['api'];

/** A pull request as the sidebar reads it from GitHub. */
export const stackPull = (number: number, headRef: string, baseRef: string, over: Record<string, unknown> = {}) => ({
  number, title: `Layer ${number}`, author: 'ada', isDraft: false, headRef, headRepository: 'octo/app', baseRef,
  reviewDecision: null, checks: null, mergeable: 'mergeable', updatedAt: '2026-10-30T10:00:00Z', url: `https://github.com/octo/app/pull/${number}`, ...over,
});

/** Shows these as the repository's open pull requests, as if GitHub had answered. */
export function seedStack(api: Api, pulls: ReturnType<typeof stackPull>[]): void {
  api.seedPullRequests(repoRoot(), { kind: 'ready', remote: 'origin', repo: { host: 'github.com', owner: 'octo', repo: 'app' }, lists: { createdByMe: pulls, reviewRequested: [], allOpen: pulls } });
}

/**
 * A repository with a base commit, a bare remote called origin, and the local branches stack-a, stack-b and stack-c, each
 * on the one before with a commit of its own. Nothing is pushed. Returns the folder of the remote, and the commit of each layer.
 */
export async function makeStack(api: Api): Promise<{ remote: string; shas: string[]; cleanup: () => void }> {
  await resetToRepository(api, repoRoot());
  commitFile('base.txt', 'base\n', 'base');
  const remote = mkdtempSync(join(tmpdir(), 'git-checkout-e2e-stack-'));
  git('init', '--bare', '-q', '--initial-branch=main', remote);
  git('remote', 'add', 'origin', remote);
  const shas: string[] = [];
  for (const [name, number] of [['stack-a', 1], ['stack-b', 2], ['stack-c', 3]] as const) {
    git('checkout', '-q', '-b', name);
    shas.push(commitFile(`${name}.txt`, `${name}\n`, `Layer ${number}`));
  }
  git('checkout', '-q', 'stack-b');
  seedStack(api, [stackPull(1, 'stack-a', 'main'), stackPull(2, 'stack-b', 'stack-a'), stackPull(3, 'stack-c', 'stack-b')]);
  return {
    remote,
    shas,
    cleanup: () => {
      git('remote', 'remove', 'origin');
      rmSync(remote, { recursive: true, force: true });
    },
  };
}
