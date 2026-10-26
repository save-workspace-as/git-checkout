import * as l10n from '@vscode/l10n';
import type * as vscode from 'vscode';

const OUTPUT_CHANNEL_NAME = l10n.t('Git Checkout');

let channel: vscode.LogOutputChannel | undefined;

function loadVscode(): typeof import('vscode') | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('vscode') as typeof import('vscode');
  } catch {
    return undefined;
  }
}

const noopLogChannel = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  dispose: () => undefined,
} as unknown as vscode.LogOutputChannel;

export function getLogChannel(): vscode.LogOutputChannel {
  const vscode = loadVscode();
  if (!vscode) {
    return noopLogChannel;
  }
  channel ??= vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME, { log: true });
  return channel;
}

export interface Logger {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** Pass caught errors as trailing args so VS Code formats the stack. */
export function createLogger(component: string): Logger {
  const tag = `[${component}]`;
  return {
    trace: (message, ...args) => getLogChannel().trace(`${tag} ${message}`, ...args),
    debug: (message, ...args) => getLogChannel().debug(`${tag} ${message}`, ...args),
    info: (message, ...args) => getLogChannel().info(`${tag} ${message}`, ...args),
    warn: (message, ...args) => getLogChannel().warn(`${tag} ${message}`, ...args),
    error: (message, ...args) => getLogChannel().error(`${tag} ${message}`, ...args),
  };
}
