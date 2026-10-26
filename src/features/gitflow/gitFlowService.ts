import * as l10n from '@vscode/l10n';
import type { CancellationToken } from 'vscode';
import { createLogger } from '../../log';
import type { GitCli, GitExecOptions } from '../../core/gitCli';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import {
  defaultGitCheckoutSettings,
  type GitCheckoutSettingsReader,
} from '../../core/gitCheckoutSettings';
import {
  fallbackGitCommands,
  formatGitFlowFallback,
  gitFlowArgs,
  gitFlowInitDefaults,
  gitFlowInitSteps,
  isGitFlowInitialized,
  parseGitFlowConfig,
  parseGitFlowVersion,
  resolveGitFlowLayout,
  validateGitFlowInit,
  validateGitFlowRequest,
  type GitFlowInitConfig,
  type GitFlowLayout,
  type GitFlowRequest,
} from './gitFlowGuide';

const log = createLogger('git-flow');

const DETECT_TIMEOUT_MS = 15_000;

/** Finish opens an editor for the merge message unless these are set. */
const GIT_FLOW_ENV: Record<string, string> = {
  GIT_EDITOR: 'true',
  GIT_MERGE_AUTOEDIT: 'no',
};

export interface GitFlowRunResult {
  available: boolean;
  ran: boolean;
  version: string | null;
  commands: readonly string[];
  message: string;
}

export interface GitFlowRunOptions {
  cancellationToken?: CancellationToken;
}

export interface GitFlowInitState {
  initialized: boolean;
  /** Layout the init form starts from: the configured one, or the usual defaults. */
  defaults: GitFlowInitConfig;
  /** Local branch names. */
  branchNames: string[];
}

export class GitFlowService {
  constructor(
    private readonly cliRegistry: GitCliRegistry,
    private readonly settings: GitCheckoutSettingsReader = defaultGitCheckoutSettings,
  ) {}

  async detect(
    repoRoot: string,
    options?: GitFlowRunOptions,
  ): Promise<{ available: boolean; version: string | null }> {
    try {
      const result = await this.cli(repoRoot).execRead(
        ['flow', 'version'],
        this.readOptions(options?.cancellationToken),
      );
      const version = parseGitFlowVersion(result.stdout, result.stderr);
      if (!version) {
        log.debug('git flow version did not report git-flow');
        return { available: false, version: null };
      }
      return { available: true, version };
    } catch (error) {
      log.debug('git-flow is not available', error);
      return { available: false, version: null };
    }
  }

  /** Whether git-flow is set up in this repository, with the values to start an init form from. */
  async readInitState(repoRoot: string, options?: GitFlowRunOptions): Promise<GitFlowInitState> {
    const config = await this.readConfig(repoRoot, options);
    const branchNames = await this.listBranches(repoRoot, options);
    return {
      initialized: isGitFlowInitialized(config),
      defaults: gitFlowInitDefaults(config, branchNames),
      branchNames,
    };
  }

  /**
   * Sets git-flow up without the git-flow command: creates the development branch from the
   * production branch when missing, records the layout in `gitflow.*` config, and switches to it.
   * The `git flow` commands then use that layout when they are installed.
   */
  async initialize(
    repoRoot: string,
    config: GitFlowInitConfig,
    options?: GitFlowRunOptions,
  ): Promise<GitFlowRunResult> {
    const branchNames = await this.listBranches(repoRoot, options);
    const errors = validateGitFlowInit(config, branchNames);
    const first = Object.values(errors)[0];
    if (first) {
      throw new Error(first);
    }
    const steps = gitFlowInitSteps(config, branchNames.includes(config.develop.trim()));
    log.info(`initialize git-flow with ${config.production.trim()} and ${config.develop.trim()}`);
    for (const args of steps) {
      await this.cli(repoRoot).execWrite(args, {
        cancellationToken: options?.cancellationToken,
        showErrorToast: false,
      });
    }
    return {
      available: true,
      ran: true,
      version: null,
      commands: steps.map((args) => `git ${args.join(' ')}`),
      message: l10n.t('Initialized git-flow with {0} and {1}', config.production.trim(), config.develop.trim()),
    };
  }

  async run(
    repoRoot: string,
    request: GitFlowRequest,
    options?: GitFlowRunOptions,
  ): Promise<GitFlowRunResult> {
    const problem = validateGitFlowRequest(request);
    if (problem) {
      throw new Error(problem);
    }
    if (request.action === 'init') {
      const state = await this.readInitState(repoRoot, options);
      return this.initialize(repoRoot, { ...state.defaults, ...request.init }, options);
    }
    const detected = await this.detect(repoRoot, options);
    if (!detected.available) {
      const layout = await this.readLayout(repoRoot, options);
      const commands = fallbackGitCommands(request, layout);
      const message = formatGitFlowFallback(commands);
      log.error(message);
      return {
        available: false,
        ran: false,
        version: null,
        commands,
        message,
      };
    }

    const args = gitFlowArgs(request);
    log.info(`git ${args.join(' ')} (${detected.version})`);
    await this.cli(repoRoot).execWrite(args, this.writeOptions(request, options?.cancellationToken));
    const command = `git ${args.join(' ')}`;
    return {
      available: true,
      ran: true,
      version: detected.version,
      commands: [command],
      message: l10n.t('Ran {0}', command),
    };
  }

  private async readConfig(repoRoot: string, options?: GitFlowRunOptions): Promise<Partial<GitFlowLayout>> {
    try {
      const result = await this.cli(repoRoot).execRead(
        ['config', '--get-regexp', '^gitflow\\.'],
        this.readOptions(options?.cancellationToken),
      );
      return parseGitFlowConfig(result.stdout);
    } catch (error) {
      // `git config --get-regexp` exits 1 when the repo has no gitflow keys.
      log.debug('could not read git-flow config', error);
      return {};
    }
  }

  private async listBranches(repoRoot: string, options?: GitFlowRunOptions): Promise<string[]> {
    try {
      const result = await this.cli(repoRoot).execRead(
        ['for-each-ref', '--format=%(refname:short)', 'refs/heads'],
        this.readOptions(options?.cancellationToken),
      );
      return result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    } catch (error) {
      log.debug('could not list local branches', error);
      return [];
    }
  }

  private async readLayout(repoRoot: string, options?: GitFlowRunOptions): Promise<GitFlowLayout> {
    const cli = this.cli(repoRoot);
    const read = this.readOptions(options?.cancellationToken);
    const config = await this.readConfig(repoRoot, options);
    let heads = '';
    try {
      heads = (
        await cli.execRead(
          ['for-each-ref', '--format=%(refname:short)', 'refs/heads/main', 'refs/heads/master'],
          read,
        )
      ).stdout;
    } catch (error) {
      log.debug('could not list main or master', error);
      heads = '';
    }
    const headNames = heads
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    return resolveGitFlowLayout(config, headNames);
  }

  private readOptions(token?: CancellationToken): GitExecOptions {
    return {
      timeoutMs: DETECT_TIMEOUT_MS,
      cancellationToken: token,
    };
  }

  private writeOptions(request: GitFlowRequest, token?: CancellationToken): GitExecOptions {
    const publish = request.action === 'publish';
    return {
      cancellationToken: token,
      showErrorToast: false,
      env: GIT_FLOW_ENV,
      network: publish,
      timeoutMs: publish ? this.settings.networkTimeoutMs() : undefined,
    };
  }

  private cli(repoRoot: string): GitCli {
    return this.cliRegistry.getOrCreate(repoRoot);
  }
}
