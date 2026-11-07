import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { MergeResult, RestTransport } from './githubRestClient';
import { mergeMethodOf, mergeSet, mergeStackForm, validateMergeStackForm, waitForMerge, type MergeLayer } from './stackMerge';

const layers: MergeLayer[] = [
  { number: 1, title: 'Schema', isDraft: false },
  { number: 2, title: 'API', isDraft: true },
  { number: 3, title: 'Page', isDraft: false },
];
const repo = { host: 'github.com', owner: 'octo', repo: 'app' };

describe('mergeStackForm', () => {
  it('offers each pull request to merge through, the top one first chosen, and the three methods', () => {
    const form = mergeStackForm(layers);
    assert.deepEqual(form.values, { through: '3', method: 'merge' });
    const through = form.fields[0];
    assert.deepEqual(through.type === 'text' && through.suggestions, [{ value: '1', label: 'Schema' }, { value: '2', label: 'API' }, { value: '3', label: 'Page' }]);
    const method = form.fields[1];
    assert.deepEqual(method.type === 'radio' && method.options.map((o) => o.value), ['merge', 'squash', 'rebase']);
  });

  it('takes in the pull request and everything below it', () => {
    assert.deepEqual(mergeSet(layers, 2).map((l) => l.number), [1, 2]);
    assert.deepEqual(mergeSet(layers, 9), []);
  });

  it('refuses a merge that would take in a draft, and allows one below it', () => {
    assert.match(validateMergeStackForm(layers, { through: '3' }).through, /Pull request #2 is a draft/);
    assert.deepEqual(validateMergeStackForm(layers, { through: '1' }), {});
  });

  it('reads a method, and falls back to a merge commit', () => {
    assert.equal(mergeMethodOf('squash'), 'squash');
    assert.equal(mergeMethodOf('nonsense'), 'merge');
  });
});

describe('waitForMerge', () => {
  const pending: MergeResult = { status: 'pending', message: '', uuid: 'u1' };
  const answering = (statuses: string[]): RestTransport & { asked: number } => {
    const transport = {
      asked: 0,
      async request() {
        const status = statuses[Math.min(transport.asked++, statuses.length - 1)];
        return { status: 200, json: { status, details: { message: `is ${status}`, uuid: 'u1' } } };
      },
    };
    return transport;
  };
  const slept: number[] = [];
  const sleep = async (ms: number) => { slept.push(ms); };

  it('returns what it is given when the merge is not pending', async () => {
    const done: MergeResult = { status: 'merged', message: 'done' };
    assert.equal(await waitForMerge(repo, 't', 3, done, answering([]), { sleep }), done);
  });

  it('asks again until the merge is no longer pending', async () => {
    slept.length = 0;
    const transport = answering(['pending', 'pending', 'merged']);
    const result = await waitForMerge(repo, 't', 3, pending, transport, { sleep, intervalMs: 50 });
    assert.equal(result.status, 'merged');
    assert.equal(transport.asked, 3);
    assert.deepEqual(slept, [50, 50, 50]);
  });

  it('gives up on a merge that takes too long, and says what to do', async () => {
    await assert.rejects(() => waitForMerge(repo, 't', 3, pending, answering(['pending']), { sleep, intervalMs: 10, timeoutMs: 30 }), /still running/);
  });
});
