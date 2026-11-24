import * as l10n from '@vscode/l10n';
import type { Progress, ProgressOptions } from 'vscode';
import { createLogger } from '../log';

const log = createLogger('progress');

/** How long a Git command runs before a notification tells the person it is still working. */
export const SLOW_WRITE_MS = 1000;

/** How many notifications of ours are showing. */
let shown = 0;

function vscodeApi(): typeof import('vscode') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('vscode') as typeof import('vscode');
}

/**
 * `vscode.window.withProgress`, counted: a Git command that runs long inside an operation which already shows a
 * notification does not add a second one. Use it for every progress notification of this extension.
 */
export async function withProgress<R>(
  options: ProgressOptions,
  task: (progress: Progress<{ message?: string; increment?: number }>, token: import('vscode').CancellationToken) => Thenable<R>,
): Promise<R> {
  shown += 1;
  try {
    return await vscodeApi().window.withProgress(options, task);
  } finally {
    shown -= 1;
  }
}

/** The Git subcommand of an argument list: `worktree` of `-C /repo worktree remove /x`. */
export function gitSubcommand(args: readonly string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '-C' || args[index] === '-c') {
      index += 1;
    } else if (!args[index].startsWith('-')) {
      return args[index];
    }
  }
  return 'command';
}

/**
 * Runs a Git command, and when it takes longer than `delayMs` shows the notification other long operations show, until it
 * ends. Nothing is shown when an operation's own notification is up, or outside VS Code.
 */
export async function noticeIfSlow<T>(args: readonly string[], run: () => Promise<T>, delayMs = SLOW_WRITE_MS): Promise<T> {
  let api: typeof import('vscode');
  try {
    api = vscodeApi();
  } catch (error) {
    // Unit tests and non-extension hosts have no vscode module.
    log.debug('no notification for a slow Git command outside VS Code', error);
    return run();
  }
  const running = run();
  const ended = running.then(() => undefined, () => undefined);
  const timer = setTimeout(() => {
    if (shown > 0) {
      return;
    }
    const title = l10n.t('Git Checkout: running git {0}', gitSubcommand(args));
    withProgress({ location: api.ProgressLocation.Notification, title }, () => ended).catch((error: unknown) => {
      log.warn('could not show the notification for a slow Git command', error);
    });
  }, delayMs);
  void ended.then(() => clearTimeout(timer));
  return running;
}
