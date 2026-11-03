/** Something that can be listened to, such as a VS Code event; the result stops the listening. */
export type Subscribe = (listener: () => void) => { dispose(): void };

/**
 * Runs `task` when it is asked for while `active()` holds. While it does not, the asks are only remembered, and one
 * run follows when `becameActive` fires. A view that nobody can see, or a window that is in the background, then
 * costs nothing to keep up to date, and it is current when it comes back.
 */
export function whenActive(
  task: () => void,
  active: () => boolean,
  becameActive: Subscribe,
): { request(): void; dispose(): void } {
  let pending = false;
  const subscription = becameActive(() => {
    if (pending && active()) {
      pending = false;
      task();
    }
  });
  return {
    request(): void {
      if (active()) {
        pending = false;
        task();
      } else {
        pending = true;
      }
    },
    dispose(): void {
      subscription.dispose();
    },
  };
}

let keepAllActive = false;

/** Treats every activity as on, whatever is on screen. A headless test window shows nothing, so its tests keep it on. */
export function keepEverythingActive(on: boolean): void {
  keepAllActive = on;
}

/** A condition made of several parts, each with its own events: it holds while `holds` does, and `changed` fires when a part may have changed it. */
export class Activity {
  private readonly listeners = new Set<() => void>();
  constructor(private readonly holds: () => boolean) {}

  /** Whether the thing is on screen right now. */
  get active(): boolean {
    return keepAllActive || this.holds();
  }

  /** The parts call this when one of them changed; whoever waited for the activity runs now. */
  changed(): void {
    if (this.active) {
      [...this.listeners].forEach((listener) => listener());
    }
  }

  /** Listen for the activity turning on. */
  readonly onDidBecomeActive: Subscribe = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => void this.listeners.delete(listener) };
  };
}
