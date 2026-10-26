/**
 * Wraps `task` so it never runs twice at once. A call made while a run is in progress does not start a
 * second one beside it: it asks for one more run after the current one, and everyone who asked in the
 * meantime shares that single follow-up. A burst of triggers (a file change, then the command that caused
 * it, then the watcher's own report) costs two runs at most, and the last one sees the final state.
 */
export function coalesced(task: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | undefined;
  let followUp: Promise<void> | undefined;

  const start = (): Promise<void> => {
    const current = task().finally(() => {
      running = undefined;
    });
    running = current;
    return current;
  };

  return () => {
    if (!running) {
      return start();
    }
    followUp ??= running
      // A failed run is reported to its own callers; the follow-up still runs.
      .catch(() => undefined)
      .then(() => {
        followUp = undefined;
        return start();
      });
    return followUp;
  };
}
