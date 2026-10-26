import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Runs a repository's git writes one at a time, and holds reads back while a write is running.
 * A call made from inside a running write (a write task that runs git itself) joins that write
 * instead of queueing behind it, which would wait on itself forever.
 */
export class GitOperationQueue {
  private writeChain: Promise<unknown> = Promise.resolve();
  private readonly inWrite = new AsyncLocalStorage<true>();

  runRead<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inWrite.getStore()) {
      return fn();
    }
    const gate = this.writeChain;
    return gate.then(() => fn());
  }

  runWrite<T>(fn: () => Promise<T>): Promise<T> {
    if (this.inWrite.getStore()) {
      return fn();
    }
    const result = this.writeChain.then(() => this.inWrite.run(true, fn));
    this.writeChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
