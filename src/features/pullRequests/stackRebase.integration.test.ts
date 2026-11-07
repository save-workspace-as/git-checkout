import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

import { initTempRepository, runGit } from '../../core/testing/gitRepoHarness';
import { rebaseStack } from './stackRebase';

type Repo = ReturnType<typeof initTempRepository>;

async function commit(r: Repo, file: string, text: string, message: string): Promise<string> {
  writeFileSync(path.join(r.repoRoot, file), text);
  await r.cli.execWrite(['add', file]);
  await r.cli.execWrite(['commit', '-m', message]);
  return (await r.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
}

/** main with a base commit, and the stack a <- b <- c, each layer adding a file. */
async function setUp() {
  const r = initTempRepository();
  await commit(r, 'base.txt', 'base\n', 'base');
  for (const name of ['a', 'b', 'c']) {
    runGit(r.repoRoot, ['checkout', '-b', name]);
    await commit(r, `${name}.txt`, `${name}\n`, `layer-${name}`);
  }
  runGit(r.repoRoot, ['checkout', 'main']);
  const rev = async (ref: string) => (await r.cli.execRead(['rev-parse', ref])).stdout.trim();
  const subjects = async (range: string) => (await r.cli.execRead(['log', '--format=%s', '--reverse', range])).stdout.trim().split('\n').filter(Boolean);
  return { r, rev, subjects };
}

describe('rebasing a stack integration', () => {
  it('leaves a stack alone that is on its trunk already', async () => {
    const { r, rev } = await setUp();
    try {
      const before = await rev('c');
      const steps = await rebaseStack(r.cli, { branches: ['a', 'b', 'c'], trunk: 'main' });
      assert.deepEqual(steps.map((s) => s.moved), [false, false, false]);
      assert.equal(await rev('c'), before);
    } finally {
      r.cleanup();
    }
  });

  it('moves every layer onto a trunk that moved on', async () => {
    const { r, subjects } = await setUp();
    try {
      await commit(r, 'main.txt', 'main\n', 'main-moves');
      const steps = await rebaseStack(r.cli, { branches: ['a', 'b', 'c'], trunk: 'main' });
      assert.deepEqual(steps.map((s) => s.moved), [true, true, true]);
      assert.deepEqual(await subjects('main..c'), ['layer-a', 'layer-b', 'layer-c']);
      assert.deepEqual(await subjects('main..a'), ['layer-a']);
      assert.deepEqual(await subjects('a..b'), ['layer-b']);
    } finally {
      r.cleanup();
    }
  });

  it('carries the layers above a layer that was amended, without bringing its old commit along', async () => {
    const { r, subjects } = await setUp();
    try {
      runGit(r.repoRoot, ['checkout', 'a']);
      writeFileSync(path.join(r.repoRoot, 'a.txt'), 'a, amended\n');
      await r.cli.execWrite(['add', 'a.txt']);
      await r.cli.execWrite(['commit', '--amend', '-m', 'layer-a-amended']);
      runGit(r.repoRoot, ['checkout', 'main']);
      const steps = await rebaseStack(r.cli, { branches: ['a', 'b', 'c'], trunk: 'main' });
      assert.deepEqual(steps.map((s) => s.moved), [false, true, true]);
      assert.deepEqual(await subjects('main..c'), ['layer-a-amended', 'layer-b', 'layer-c']);
    } finally {
      r.cleanup();
    }
  });

  it('moves only what is above a parent that was squash-merged, when the parent branch is still here', async () => {
    const { r, subjects } = await setUp();
    try {
      // GitHub squashes layer a into main: the same change, as a commit of its own.
      writeFileSync(path.join(r.repoRoot, 'a.txt'), 'a\n');
      await r.cli.execWrite(['add', 'a.txt']);
      await r.cli.execWrite(['commit', '-m', 'squash-of-a']);
      const steps = await rebaseStack(r.cli, { branches: ['b', 'c'], trunk: 'main', mergedParent: 'a' });
      assert.deepEqual(steps.map((s) => s.moved), [true, true]);
      assert.deepEqual(await subjects('main..c'), ['layer-b', 'layer-c']);
      // Running it again does nothing, though the merged parent is still there.
      assert.deepEqual((await rebaseStack(r.cli, { branches: ['b', 'c'], trunk: 'main', mergedParent: 'a' })).map((s) => s.moved), [false, false]);
    } finally {
      r.cleanup();
    }
  });

  it('stops at a conflict, and carries on from there when it is run again', async () => {
    const { r, subjects, rev } = await setUp();
    try {
      await commit(r, 'b.txt', 'main wrote b\n', 'main-writes-b');
      const before = await rev('c');
      await assert.rejects(() => rebaseStack(r.cli, { branches: ['a', 'b', 'c'], trunk: 'main' }));
      assert.equal(await rev('c'), before, 'the layers above the conflict have not moved');
      // The conflict is in layer b: take its version, and finish the rebase of that layer.
      writeFileSync(path.join(r.repoRoot, 'b.txt'), 'b\n');
      await r.cli.execWrite(['add', 'b.txt']);
      runGit(r.repoRoot, ['-c', 'core.editor=true', 'rebase', '--continue']);
      const steps = await rebaseStack(r.cli, { branches: ['a', 'b', 'c'], trunk: 'main' });
      assert.deepEqual(steps.map((s) => s.moved), [false, false, true]);
      assert.deepEqual(await subjects('main..c'), ['layer-a', 'layer-b', 'layer-c']);
    } finally {
      r.cleanup();
    }
  });
});
