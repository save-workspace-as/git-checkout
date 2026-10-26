import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { coalesced } from './coalesced';

/** A task that finishes when told to, and counts how often it started. */
function controllableTask() {
  const gates: (() => void)[] = [];
  let starts = 0;
  const task = (): Promise<void> => {
    starts += 1;
    return new Promise<void>((resolve) => gates.push(resolve));
  };
  return {
    task,
    get starts() { return starts; },
    finish: async (): Promise<void> => {
      gates.shift()?.();
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

describe('coalesced', () => {
  it('runs right away when nothing is running', async () => {
    const t = controllableTask();
    const run = coalesced(t.task);
    const done = run();
    assert.equal(t.starts, 1);
    await t.finish();
    await done;
  });

  it('turns a burst of calls into one run plus one follow-up', async () => {
    const t = controllableTask();
    const run = coalesced(t.task);
    const first = run();
    const burst = [run(), run(), run(), run()];
    assert.equal(t.starts, 1, 'nothing starts beside the running one');
    await t.finish();
    assert.equal(t.starts, 2, 'one follow-up covers every call made meanwhile');
    await t.finish();
    await Promise.all([first, ...burst]);
    assert.equal(t.starts, 2);
  });

  it('hands every call made during a run the same follow-up', async () => {
    const t = controllableTask();
    const run = coalesced(t.task);
    void run();
    const a = run();
    const b = run();
    assert.equal(a, b);
    await t.finish();
    await t.finish();
    await a;
  });

  it('runs again for a call made after everything finished', async () => {
    const t = controllableTask();
    const run = coalesced(t.task);
    const first = run();
    await t.finish();
    await first;
    const second = run();
    assert.equal(t.starts, 2);
    await t.finish();
    await second;
  });

  it('still runs the follow-up after a run fails, and tells the failed run\'s caller', async () => {
    let attempt = 0;
    const run = coalesced(async () => {
      attempt += 1;
      if (attempt === 1) {
        await new Promise((resolve) => setImmediate(resolve));
        throw new Error('first run failed');
      }
    });
    const failing = run();
    const followUp = run();
    await assert.rejects(failing, /first run failed/);
    await followUp;
    assert.equal(attempt, 2);
  });
});
