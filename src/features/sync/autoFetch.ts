import { createLogger } from '../../log';

const log = createLogger('auto-fetch');

/** After this many failures in a row a repository is tried only every eighth cycle. */
const MAX_BACKOFF_CYCLES = 8;

/** What auto-fetch needs from the window; the extension supplies the real thing, tests a fake. */
export interface AutoFetchHost {
  enabled(): boolean;
  intervalSeconds(): number;
  /** Open repository roots. */
  roots(): string[];
  /** Whether the person is looking at this window; a background window does not fetch. */
  windowActive(): boolean;
  /** Whether a merge, rebase or similar is in progress in the repository. */
  operationActive(root: string): Promise<boolean>;
  hasRemotes(root: string): Promise<boolean>;
  fetch(root: string): Promise<void>;
}

/**
 * Fetches every open repository from its remotes on a timer, so the graph shows what others pushed
 * without a manual fetch. It skips a repository that is busy, has no remote or keeps failing, and
 * never asks for a password.
 */
export class AutoFetch {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private started = false;
  private stopped = false;
  private readonly failures = new Map<string, { count: number; skip: number }>();

  constructor(
    private readonly host: AutoFetchHost,
    private readonly schedule: (callback: () => void, ms: number) => ReturnType<typeof setTimeout> = setTimeout,
    private readonly cancel: (timer: ReturnType<typeof setTimeout>) => void = clearTimeout,
  ) {}

  start(): void {
    this.started = true;
    this.stopped = false;
    this.reschedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) { this.cancel(this.timer); }
    this.timer = undefined;
  }

  /** Reads the settings again: call when they change. */
  reschedule(): void {
    if (this.timer) { this.cancel(this.timer); }
    this.timer = undefined;
    if (!this.started || this.stopped || !this.host.enabled()) { return; }
    const ms = Math.max(30, this.host.intervalSeconds()) * 1000;
    this.timer = this.schedule(() => { void this.tick().finally(() => this.reschedule()); }, ms);
  }

  /** One round over every repository. Rounds never overlap; `anyWindow` fetches even from a background window. */
  async tick(anyWindow = false): Promise<void> {
    if (this.running || !this.host.enabled() || !(anyWindow || this.host.windowActive())) { return; }
    this.running = true;
    try {
      for (const root of this.host.roots()) {
        if (this.stopped || !(anyWindow || this.host.windowActive())) { return; }
        await this.fetchOne(root);
      }
    } finally {
      this.running = false;
    }
  }

  private async fetchOne(root: string): Promise<void> {
    const failed = this.failures.get(root);
    if (failed && failed.skip > 0) {
      failed.skip -= 1;
      return;
    }
    try {
      if (await this.host.operationActive(root) || !(await this.host.hasRemotes(root))) { return; }
      await this.host.fetch(root);
      this.failures.delete(root);
    } catch (error) {
      const count = (failed?.count ?? 0) + 1;
      // Back off: a repository that needs a password or is offline is retried less and less often.
      this.failures.set(root, { count, skip: Math.min(count, MAX_BACKOFF_CYCLES) - 1 });
      log.warn(`background fetch failed for ${root} (${count} in a row)`, error);
    }
  }
}
