import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mockGitCli } from '../../core/testing/serviceTestUtils';
import type { GitCli } from '../../core/gitCli';
import { resolveCompare } from './compareTargets';

const answering = (answers: Record<string, string>): GitCli =>
  mockGitCli({
    execRead: async (args) => {
      const hit = Object.entries(answers).find(([key]) => args.join(' ').includes(key));
      if (!hit) { throw new Error('unknown revision'); }
      return { stdout: `${hit[1]}\n` };
    },
  }).cli;

describe('resolveCompare', () => {
  it('compares a commit with HEAD as what changed from the commit to HEAD', async () => {
    assert.deepEqual(await resolveCompare(answering({ 'HEAD^{commit}': 'h1' }), 'head', 'c1'), { ok: true, base: 'c1', head: 'h1' });
  });

  it('compares a commit with where it and HEAD diverged', async () => {
    assert.deepEqual(await resolveCompare(answering({ 'merge-base HEAD c1': 'm1' }), 'mergeBase', 'c1'), { ok: true, base: 'm1', head: 'c1' });
    const none = await resolveCompare(answering({}), 'mergeBase', 'c1');
    assert.equal(none.ok, false);
  });

  it('compares a branch with its upstream, and says so when it has none', async () => {
    assert.deepEqual(await resolveCompare(answering({ 'topic@{upstream}^{commit}': 'u1' }), 'upstream', 'c1', 'topic'), { ok: true, base: 'u1', head: 'c1' });
    const none = await resolveCompare(answering({}), 'upstream', 'c1', 'topic');
    assert.deepEqual(none, { ok: false, message: 'topic has no upstream branch to compare with.' });
  });

  it('compares a commit with a picked ref, and refuses one that names nothing or looks like an option', async () => {
    assert.deepEqual(await resolveCompare(answering({ 'v1.0^{commit}': 't1' }), 'ref', 'c1', 'v1.0'), { ok: true, base: 't1', head: 'c1' });
    assert.equal((await resolveCompare(answering({}), 'ref', 'c1', 'gone')).ok, false);
    const option = await resolveCompare(answering({ '--output': 'x' }), 'ref', 'c1', '--output=x');
    assert.equal(option.ok, false);
  });
});
