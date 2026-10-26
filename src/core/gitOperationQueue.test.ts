import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { GitOperationQueue } from './gitOperationQueue';

describe('GitOperationQueue', () => {
  it('serializes writes', async () => {
    const queue = new GitOperationQueue();
    const order: string[] = [];

    const w1 = queue.runWrite(async () => {
      order.push('w1-start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('w1-end');
    });
    const w2 = queue.runWrite(async () => {
      order.push('w2-start');
      order.push('w2-end');
    });

    await Promise.all([w1, w2]);
    assert.deepEqual(order, ['w1-start', 'w1-end', 'w2-start', 'w2-end']);
  });

  it('defers reads until the current write finishes', async () => {
    const queue = new GitOperationQueue();
    const order: string[] = [];

    const write = queue.runWrite(async () => {
      order.push('write-start');
      await new Promise((r) => setTimeout(r, 25));
      order.push('write-end');
    });

    const read = queue.runRead(async () => {
      order.push('read');
      return 'ok';
    });

    await Promise.all([write, read]);
    assert.deepEqual(order, ['write-start', 'write-end', 'read']);
    assert.equal(await read, 'ok');
  });

  it('does not run writes at the same time', async () => {
    const queue = new GitOperationQueue();
    let inFlight = 0;
    let maxInFlight = 0;

    const run = (): Promise<unknown> =>
      queue.runWrite(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 15));
        inFlight -= 1;
      });

    await Promise.all([run(), run(), run()]);
    assert.equal(maxInFlight, 1);
    assert.equal(inFlight, 0);
  });

  it('continues the write chain after a rejected write', async () => {
    const queue = new GitOperationQueue();
    const order: string[] = [];

    await queue
      .runWrite(async () => {
        order.push('fail');
        throw new Error('boom');
      })
      .catch(() => undefined);

    await queue.runWrite(async () => {
      order.push('after-fail');
    });

    assert.deepEqual(order, ['fail', 'after-fail']);
  });

  it('lets a write that runs git itself join its own write instead of waiting on it', async () => {
    const queue = new GitOperationQueue();
    const order: string[] = [];
    const outer = queue.runWrite(async () => {
      order.push('outer-start');
      await queue.runWrite(async () => {
        order.push('inner-write');
      });
      await queue.runRead(async () => {
        order.push('inner-read');
      });
      order.push('outer-end');
    });
    const next = queue.runWrite(async () => {
      order.push('next');
    });
    await Promise.race([
      Promise.all([outer, next]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('deadlocked')), 1000)),
    ]);
    assert.deepEqual(order, ['outer-start', 'inner-write', 'inner-read', 'outer-end', 'next']);
  });
});

