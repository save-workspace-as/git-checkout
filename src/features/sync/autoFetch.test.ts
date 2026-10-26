import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { AutoFetch, type AutoFetchHost } from './autoFetch';

function host(overrides: Partial<AutoFetchHost> = {}) {
  const fetched: string[] = [];
  const value: AutoFetchHost = {
    enabled: () => true,
    intervalSeconds: () => 180,
    roots: () => ['/a', '/b'],
    windowActive: () => true,
    operationActive: async () => false,
    hasRemotes: async () => true,
    fetch: async (root) => { fetched.push(root); },
    ...overrides,
  };
  return { value, fetched };
}

describe('AutoFetch', () => {
  it('fetches every open repository in turn', async () => {
    const { value, fetched } = host();
    await new AutoFetch(value).tick();
    assert.deepEqual(fetched, ['/a', '/b']);
  });

  it('does nothing when it is off or the window is in the background', async () => {
    const off = host({ enabled: () => false });
    await new AutoFetch(off.value).tick();
    const background = host({ windowActive: () => false });
    await new AutoFetch(background.value).tick();
    assert.deepEqual([...off.fetched, ...background.fetched], []);
  });

  it('can be told to fetch even from a background window', async () => {
    const { value, fetched } = host({ windowActive: () => false });
    await new AutoFetch(value).tick(true);
    assert.deepEqual(fetched, ['/a', '/b']);
  });

  it('skips a repository in the middle of an operation or without a remote', async () => {
    const { value, fetched } = host({
      operationActive: async (root) => root === '/a',
      hasRemotes: async (root) => root !== '/b',
      roots: () => ['/a', '/b', '/c'],
    });
    await new AutoFetch(value).tick();
    assert.deepEqual(fetched, ['/c']);
  });

  it('does not start a round while another is running', async () => {
    let release = (): void => undefined;
    const { value, fetched } = host({
      roots: () => ['/a'],
      fetch: (root) => new Promise<void>((resolve) => { fetched.push(root); release = resolve; }),
    });
    const auto = new AutoFetch(value);
    const first = auto.tick();
    await auto.tick();
    await new Promise((resolve) => setImmediate(resolve));
    release();
    await first;
    assert.deepEqual(fetched, ['/a']);
  });

  it('keeps going after one repository fails, then backs off from it', async () => {
    const calls: string[] = [];
    const { value } = host({
      fetch: async (root) => {
        calls.push(root);
        if (root === '/a') { throw new Error('offline'); }
      },
    });
    const auto = new AutoFetch(value);
    await auto.tick(); // /a fails, /b still runs
    await auto.tick(); // /a is tried again at once, fails a second time
    await auto.tick(); // now /a sits out one round
    await auto.tick(); // and is tried again
    assert.deepEqual(calls, ['/a', '/b', '/a', '/b', '/b', '/a', '/b']);
  });

  it('schedules the next round from the interval setting, at least 30 seconds out', () => {
    const delays: number[] = [];
    const { value } = host({ intervalSeconds: () => 5 });
    const auto = new AutoFetch(value, (_callback, ms) => { delays.push(ms); return 0 as unknown as ReturnType<typeof setTimeout>; }, () => undefined);
    auto.start();
    assert.deepEqual(delays, [30_000]);
  });

  it('does not schedule when it is off, and stop cancels the timer', () => {
    const cancelled: unknown[] = [];
    const off = host({ enabled: () => false });
    const scheduled: number[] = [];
    const idle = new AutoFetch(off.value, (_c, ms) => { scheduled.push(ms); return 1 as unknown as ReturnType<typeof setTimeout>; }, () => undefined);
    idle.start();
    assert.deepEqual(scheduled, []);
    const on = host();
    const auto = new AutoFetch(on.value, () => 7 as unknown as ReturnType<typeof setTimeout>, (timer) => cancelled.push(timer));
    auto.start();
    auto.stop();
    assert.deepEqual(cancelled, [7]);
  });
});
