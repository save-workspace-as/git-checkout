import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';

import { createPerfContext, median, PERF_OPERATIONS, timeOperation, type PerfContext } from './perfOps';

/**
 * Times the main views' git work against a large repository, such as a clone of VS Code with about 170 000 commits:
 *
 *   GIT_CHECKOUT_PERF_REPO=/path/to/clone npm run test:perf
 *
 * Without that variable the tests are skipped. The budgets are about twice what a laptop takes today, so a slowdown shows
 * and noise does not. Use a clone: `git status` may refresh the index.
 */
const repo = process.env.GIT_CHECKOUT_PERF_REPO;

/** Milliseconds each operation may take, at the median of three runs. */
const BUDGET_MS: Record<string, number> = {
  'graph: first page': 400,
  'graph: the next page': 500,
  'graph: 2000 deep': 600,
  'graph: refs fingerprint': 150,
  'search: first batch of a word in messages': 600,
  'search: a word in messages': 4000,
  'search: by author': 4000,
  'parse: 20000 commits of git log': 300,
  'layout: lanes of 20000 commits': 400,
  'refs: for-each-ref of branches, tags, remotes': 150,
  'tree: every file at HEAD': 300,
  'tree: folder tree of every path': 300,
  'blame: first page of the file': 4000,
  'file history: first page': 1500,
  status: 1500,
  'diff stat of the last commit': 300,
};

describe('large repository', { skip: repo ? false : 'set GIT_CHECKOUT_PERF_REPO to a large repository' }, () => {
  let context: PerfContext;
  const medians = new Map<string, number>();

  before(async () => {
    context = await createPerfContext(repo!, process.env.GIT_CHECKOUT_PERF_FILE);
    for (const operation of PERF_OPERATIONS) {
      medians.set(operation.name, median((await timeOperation(context, operation, 3)).ms));
    }
  });

  for (const operation of PERF_OPERATIONS) {
    it(`${operation.name} stays within its budget`, () => {
      const budget = BUDGET_MS[operation.name];
      assert.ok(budget !== undefined, `no budget for ${operation.name}`);
      const took = medians.get(operation.name)!;
      assert.ok(took <= budget, `${operation.name} took ${took.toFixed(0)} ms, over its budget of ${budget} ms`);
    });
  }

  it('filters a search by author as fast as scanning, because the two read history side by side', () => {
    const plain = medians.get('search: a word in messages')!;
    const filtered = medians.get('search: by author')!;
    assert.ok(filtered <= plain * 1.6 + 200, `by author took ${filtered.toFixed(0)} ms against ${plain.toFixed(0)} ms for a word`);
  });

  it('fetches history in few pages: a page of the next 240 commits costs about as much as a page of 80', () => {
    assert.ok(medians.get('graph: the next page')! <= medians.get('graph: first page')! * 3);
  });
});
