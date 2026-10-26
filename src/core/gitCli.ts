import * as l10n from '@vscode/l10n';
import { spawn } from 'child_process';
import * as path from 'path';
import type { CancellationToken } from 'vscode';
import { GitCliError, isGitLockError } from './gitCliError';
import type { GitOperationQueue } from './gitOperationQueue';
import { createLogger } from '../log';

const log = createLogger('git');

function showGitErrorToast(message: string): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vscode = require('vscode') as typeof import('vscode');
    void vscode.window.showErrorMessage(message);
  } catch (error) {
    // Unit tests and non-extension hosts have no vscode module.
    log.debug('could not show Git error notification outside VS Code', error);
  }
}

export function normalizeGitPath(repoRoot: string, raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    return repoRoot;
  }
  return path.isAbsolute(trimmed)
    ? path.normalize(trimmed)
    : path.normalize(path.resolve(repoRoot, trimmed));
}

const GIT_DISCOVERY_ENV = ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR'] as const;

/** Drop inherited git-dir variables so cwd selects the worktree and its commondir file. */
export function gitChildEnv(
  base: NodeJS.ProcessEnv,
  extra?: Record<string, string>,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base };
  for (const key of GIT_DISCOVERY_ENV) {
    delete env[key];
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      env[key] = value;
    }
  }
  return env;
}

const DEFAULT_READ_TIMEOUT_MS = 30_000;
const DEFAULT_WRITE_TIMEOUT_MS = 120_000;

/** Subcommands whose `-m` / `--message` value is a commit message, which the log must not keep. */
const MESSAGE_COMMANDS = new Set(['commit', 'commit-tree', 'merge', 'tag', 'stash', 'notes']);

function gitSubcommand(args: readonly string[]): string | undefined {
  for (const arg of args) {
    if (arg === '--') {
      return undefined;
    }
    if (!arg.startsWith('-')) {
      return arg;
    }
  }
  return undefined;
}

/** Drop credentials embedded in a URL (`https://user:token@host` becomes `https://host`). */
function redactUrlUserinfo(value: string): string {
  return value.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s]+@/gi, '$1');
}

/** Arguments as they should appear in the log: what Git ran, without a message or a credential. */
export function formatGitArgs(args: readonly string[]): string {
  const redactMessage = MESSAGE_COMMANDS.has(gitSubcommand(args) ?? '');
  const shown: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (redactMessage && (arg === '-m' || arg === '--message')) {
      shown.push(arg, '<message>');
      i += 1;
      continue;
    }
    if (redactMessage && (arg.startsWith('--message=') || (arg.startsWith('-m') && !arg.startsWith('--') && arg.length > 2))) {
      shown.push(arg.startsWith('--') ? '--message=<message>' : '-m<message>');
      continue;
    }
    shown.push(redactUrlUserinfo(arg));
  }
  return shown.join(' ');
}

/** The command line as it should appear in the log. */
export function formatGitCommand(args: readonly string[]): string {
  return `git ${formatGitArgs(args)}`;
}

export interface GitExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  stdoutBytes?: Uint8Array;
}

export interface GitExecOptions {
  timeoutMs?: number;
  cancellationToken?: CancellationToken;
  showErrorToast?: boolean;
  network?: boolean;
  /** When true, stdout is returned as raw bytes (latin1 round-trip safe for base64). */
  binaryStdout?: boolean;
  /** Extra environment variables for the git child process. */
  env?: Record<string, string>;
  /** Called with each piece of stderr as it arrives, such as `git clone --progress` output. */
  onStderr?: (chunk: string) => void;
}

export class GitCli {
  constructor(
    private readonly gitPath: string,
    private readonly repoRoot: string,
    private readonly queue: GitOperationQueue,
  ) {}

  /** Where Git keeps this repository's data; it does not change while the repository is open. */
  private gitDirectories: Promise<{ gitDir: string; commonDir: string }> | undefined;

  resolveGitDirectories(): Promise<{ gitDir: string; commonDir: string }> {
    // Read once. Every refresh asks, and each answer used to cost two `git rev-parse` processes.
    this.gitDirectories ??= this.lookUpGitDirectories().catch((error: unknown) => {
      this.gitDirectories = undefined;
      throw error;
    });
    return this.gitDirectories;
  }

  private async lookUpGitDirectories(): Promise<{ gitDir: string; commonDir: string }> {
    try {
      return await this.readGitDirectories(['--path-format=absolute']);
    } catch (error) {
      log.warn('absolute git dir resolution failed; using cwd-relative paths', error);
      return this.readGitDirectories([]);
    }
  }

  private async readGitDirectories(
    prefix: string[],
  ): Promise<{ gitDir: string; commonDir: string }> {
    // One process answers both questions, one per line.
    const [gitDir = '', commonDir = ''] = (
      await this.execRead(['rev-parse', ...prefix, '--git-dir', '--git-common-dir'])
    ).stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return {
      gitDir: this.normalizeGitPath(gitDir),
      commonDir: this.normalizeGitPath(commonDir),
    };
  }

  async revParseShortHead(options?: GitExecOptions): Promise<string | null> {
    try {
      const result = await this.execRead(['rev-parse', '--short', 'HEAD'], options);
      const value = result.stdout.trim();
      return value || null;
    } catch (error) {
      log.debug('could not resolve HEAD', error);
      return null;
    }
  }

  private normalizeGitPath(raw: string): string {
    return normalizeGitPath(this.repoRoot, raw);
  }

  async isInsideWorkTree(options?: GitExecOptions): Promise<boolean> {
    const result = await this.execRead(['rev-parse', '--is-inside-work-tree'], options);
    return result.stdout.trim() === 'true';
  }

  async execRead(args: string[], options?: GitExecOptions): Promise<GitExecResult> {
    // Reading must not take locks: `git status` otherwise refreshes the index and holds `index.lock` for a
    // moment, which can make a write from another process (VS Code's Git extension, or a merge, rebase or
    // abort) fail with "Unable to create index.lock".
    const readOptions = { ...options, env: { GIT_OPTIONAL_LOCKS: '0', ...options?.env } };
    return this.queue.runRead(() => this.spawnGit(args, readOptions, DEFAULT_READ_TIMEOUT_MS));
  }

  async execWrite(args: string[], options?: GitExecOptions): Promise<GitExecResult> {
    return this.queue.runWrite(() => this.spawnGit(args, options, DEFAULT_WRITE_TIMEOUT_MS, undefined, true));
  }

  async execWriteWithInput(
    args: string[],
    input: string,
    options?: GitExecOptions,
  ): Promise<GitExecResult> {
    return this.queue.runWrite(() =>
      this.spawnGit(args, options, DEFAULT_WRITE_TIMEOUT_MS, input, true),
    );
  }

  runWriteTask<T>(fn: () => Promise<T>): Promise<T> {
    return this.queue.runWrite(fn);
  }

  private spawnGit(
    args: string[],
    options: GitExecOptions | undefined,
    defaultTimeoutMs: number,
    stdinInput?: string,
    write = false,
  ): Promise<GitExecResult> {
    const timeoutMs = options?.timeoutMs ?? defaultTimeoutMs;
    const token = options?.cancellationToken;
    const showErrorToast = options?.showErrorToast ?? false;
    const network = options?.network ?? false;
    const startedAt = Date.now();
    const command = formatGitCommand(args);
    const elapsed = (): string => `${Date.now() - startedAt}ms`;
    /** Writes are operations a person started, so they are logged at info. Reads stay at debug. */
    const record = (failed: boolean, error?: GitCliError): void => {
      if (write) {
        if (failed) {
          log.warn(`${command} failed [${elapsed()}]`, error);
        } else {
          log.info(`${command} [${elapsed()}]`);
        }
        return;
      }
      log.debug(failed ? `${command} failed [${elapsed()}]: ${error?.message ?? ''}` : `${command} [${elapsed()}]`);
    };

    return new Promise((resolve, reject) => {
      if (token?.isCancellationRequested) {
        if (write) {
          log.info(`${command} canceled`);
        }
        reject(
          new GitCliError('Cancelled', l10n.t('Git operation canceled.'), this.repoRoot),
        );
        return;
      }

      const fullArgs = ['-c', 'core.quotepath=false', ...args];
      const env = gitChildEnv(process.env, options?.env);
      if (network) {
        env.GIT_TERMINAL_PROMPT = '0';
      }
      const useStdin = stdinInput !== undefined;
      const child = spawn(this.gitPath, fullArgs, {
        cwd: this.repoRoot,
        env,
        windowsHide: true,
        stdio: useStdin || network ? ['pipe', 'pipe', 'pipe'] : undefined,
      });

      const binaryStdout = options?.binaryStdout ?? false;
      let stdout = '';
      const stdoutChunks: Buffer[] = [];
      let stderr = '';
      let settled = false;

      const finish = (error: GitCliError): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        // A timeout already logged its own warning.
        if (error.code !== 'Timeout') {
          record(true, error);
        }
        reject(error);
      };

      const succeed = (result: GitExecResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        record(false);
        resolve(result);
      };

      const timer = setTimeout(() => {
        log.warn(`${command} timed out after ${timeoutMs}ms`);
        child.kill('SIGTERM');
        const timeoutMessage = network
          ? l10n.t(
              'Git timed out after {0} ms. A hook or the network may be waiting for input. Run "Git Checkout: Show Output" for details, or try the command in a terminal.',
              timeoutMs,
            )
          : l10n.t('Git timed out after {0} ms: git {1}', timeoutMs, formatGitArgs(args));
        finish(new GitCliError('Timeout', timeoutMessage, this.repoRoot, stderr, null));
      }, timeoutMs);

      token?.onCancellationRequested(() => {
        child.kill('SIGTERM');
        finish(new GitCliError('Cancelled', l10n.t('Git operation canceled.'), this.repoRoot, stderr));
      });

      if (useStdin && child.stdin) {
        child.stdin.end(stdinInput, 'utf8');
      } else if (network && child.stdin) {
        child.stdin.end();
      }

      const out = child.stdout;
      const err = child.stderr;
      if (out) {
        if (binaryStdout) {
          out.on('data', (chunk: Buffer) => {
            stdoutChunks.push(chunk);
          });
        } else {
          out.setEncoding('utf8');
          out.on('data', (chunk: string) => {
            stdout += chunk;
          });
        }
      }
      if (err) {
        err.setEncoding('utf8');
        err.on('data', (chunk: string) => {
          stderr += chunk;
          options?.onStderr?.(chunk);
        });
      }

      child.on('error', (err) => {
        finish(
          new GitCliError(
            'ExitCode',
            l10n.t('Could not start Git: {0}', err.message),
            this.repoRoot,
            stderr,
            null,
          ),
        );
      });

      child.on('close', (code) => {
        const exitCode = code ?? 1;
        if (exitCode === 0) {
          if (binaryStdout) {
            const bytes = Buffer.concat(stdoutChunks);
            succeed({
              stdout: bytes.toString('latin1'),
              stderr,
              exitCode,
              stdoutBytes: new Uint8Array(bytes),
            });
          } else {
            succeed({ stdout, stderr, exitCode });
          }
          return;
        }

        if (isGitLockError(stderr)) {
          const err = new GitCliError(
            'Lock',
            l10n.t('The Git repository is locked. Try again when the current Git operation finishes.'),
            this.repoRoot,
            stderr,
            exitCode,
          );
          if (showErrorToast) {
            showGitErrorToast(err.message);
          }
          finish(err);
          return;
        }

        const err = new GitCliError(
          'ExitCode',
          `git exited with code ${exitCode}: ${stderr.trim() || args.join(' ')}`,
          this.repoRoot,
          stderr,
          exitCode,
        );
        if (showErrorToast) {
          showGitErrorToast(err.message);
        }
        finish(err);
      });
    });
  }
}
