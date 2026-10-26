import * as fs from 'fs/promises';
import * as path from 'path';
import type * as vscode from 'vscode';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import type { GitExtensionService } from '../../core/gitExtensionService';
import type { Repository } from '../../core/vscodeGitApi';
import type { GitExecOptions } from '../../core/gitCli';
import {
  defaultGitCheckoutSettings,
  type GitCheckoutSettingsReader,
} from '../../core/gitCheckoutSettings';
import { isGitConfigTrue } from '../signing/signingDiagnostics';
import { createLogger } from '../../log';
import { RepositoryNotOpenError } from '../../core/repositoryNotOpenError';

const log = createLogger('commit');

export class CommitService {
  constructor(
    private readonly gitService: GitExtensionService,
    private readonly cliRegistry: GitCliRegistry,
    private readonly settings: GitCheckoutSettingsReader = defaultGitCheckoutSettings,
  ) {}

  async loadCommitTemplate(repoRoot: string): Promise<string> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    try {
      const config = await cli.execRead(['config', '--get', 'commit.template']);
      const templatePath = config.stdout.trim();
      if (!templatePath) {
        return '';
      }
      const resolved = path.isAbsolute(templatePath)
        ? templatePath
        : path.join(repoRoot, templatePath);
      return (await fs.readFile(resolved, 'utf8')).trim();
    } catch (error) {
      log.debug('could not load commit template', error);
      return '';
    }
  }

  async loadRecentSubjects(repoRoot: string, limit: number): Promise<string[]> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    try {
      const result = await cli.execRead(['log', '-n', String(limit), '--format=%s']);
      return result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    } catch (error) {
      log.warn('could not load recent commit subjects', error);
      return [];
    }
  }

  async isHeadPushedToUpstream(repoRoot: string): Promise<boolean> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    try {
      const head = (await cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      const upstream = (await cli.execRead(['rev-parse', '@{upstream}'])).stdout.trim();
      return head === upstream;
    } catch (error) {
      log.debug('could not compare HEAD with its upstream', error);
      return false;
    }
  }

  async getGpgsign(repoRoot: string): Promise<boolean> {
    return this.readConfigFlag(repoRoot, 'commit.gpgsign');
  }

  async getTagGpgSign(repoRoot: string): Promise<boolean> {
    return this.readConfigFlag(repoRoot, 'tag.gpgSign');
  }

  async setGpgsign(repoRoot: string, enabled: boolean): Promise<void> {
    await this.setSigning(repoRoot, 'commit', enabled);
  }

  async setTagGpgSign(repoRoot: string, enabled: boolean): Promise<void> {
    await this.setSigning(repoRoot, 'tag', enabled);
  }

  async setSigning(repoRoot: string, target: 'commit' | 'tag', enabled: boolean): Promise<void> {
    const key = target === 'commit' ? 'commit.gpgsign' : 'tag.gpgSign';
    log.info(`${key}=${enabled} in ${repoRoot}`);
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    await cli.execWrite(['config', key, enabled ? 'true' : 'false'], {
      showErrorToast: true,
    });
  }

  async commit(
    repoRoot: string,
    message: string,
    amend: boolean,
    options?: { cancellationToken?: vscode.CancellationToken },
  ): Promise<void> {
    const repo = this.requireRepository(repoRoot);
    const execOpts = this.execOptions(options?.cancellationToken);
    const skipHooks = this.settings.gitSkipHooks();

    log.info(`commit${amend ? ' (amend)' : ''} in ${repoRoot}`);
    await this.cliRegistry.runWrite(repoRoot, async () => {
      if (!skipHooks && !amend) {
        try {
          await repo.commit(message);
          return;
        } catch (error) {
          log.warn('vscode.git commit failed; falling back to CLI', error);
        }
      }

      const cli = this.cliRegistry.getOrCreate(repoRoot);
      const args = ['commit', '-m', message];
      if (amend) {
        args.push('--amend');
      }
      if (skipHooks) {
        args.push('--no-verify');
      }
      await cli.execWrite(args, execOpts);
    });
  }

  private async readConfigFlag(repoRoot: string, key: string): Promise<boolean> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    try {
      const result = await cli.execRead(['config', '--get', key]);
      return isGitConfigTrue(result.stdout);
    } catch (error) {
      // `git config --get` exits 1 when the key is unset.
      log.debug(`${key} is not configured`, error);
      return false;
    }
  }

  private execOptions(token?: vscode.CancellationToken): GitExecOptions {
    return {
      cancellationToken: token,
      showErrorToast: true,
    };
  }

  private requireRepository(repoRoot: string): Repository {
    const repo = this.gitService.getRepositories().find((r) => r.rootUri.fsPath === repoRoot);
    if (!repo) {
      throw new RepositoryNotOpenError();
    }
    return repo;
  }
}
