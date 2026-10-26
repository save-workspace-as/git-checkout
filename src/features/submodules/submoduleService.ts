import * as path from 'node:path';
import * as l10n from '@vscode/l10n';

import { createLogger } from '../../log';
import type { GitSubmoduleDto } from '../../shared/submodules/submoduleProtocol';
import type { GitCli } from '../../core/gitCli';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import { parseSubmoduleStatus } from './submoduleParser';
import { submoduleAddArgs, type SubmoduleAddRequest } from './submoduleAdd';

const log = createLogger('submodule');

export class SubmoduleService {
  constructor(private readonly cliRegistry: GitCliRegistry) {}

  async add(repoRoot: string, request: SubmoduleAddRequest): Promise<void> {
    log.info('add submodule');
    await this.cli(repoRoot).execWrite(submoduleAddArgs(request));
    if (request.recursive) {
      await this.init(repoRoot, [request.path.trim()]);
    }
  }

  /** Deinitializes the submodule and removes it from the index, `.gitmodules`, and working tree. */
  async remove(repoRoot: string, submodulePath: string): Promise<void> {
    const target = submodulePath.trim();
    if (!target || target.startsWith('-') || path.isAbsolute(target) || /[\u0000-\u001f\u007f]/.test(target)) {
      throw new Error(l10n.t('Enter a relative submodule path.'));
    }
    log.info(`remove submodule ${target}`);
    const cli = this.cli(repoRoot);
    await cli.execWrite(['submodule', 'deinit', '-f', '--', target]);
    await cli.execWrite(['rm', '-f', '--', target]);
  }

  async list(repoRoot: string): Promise<GitSubmoduleDto[]> {
    const result = await this.cli(repoRoot).execRead(['submodule', 'status', '--recursive']);
    return parseSubmoduleStatus(result.stdout, repoRoot);
  }

  /** `git submodule update --init --recursive`, optionally limited to paths. */
  async init(repoRoot: string, paths: readonly string[] = []): Promise<void> {
    await this.updateCommand(repoRoot, paths, true);
  }

  /** `git submodule update --recursive` for already checked out submodules. */
  async update(repoRoot: string, paths: readonly string[] = []): Promise<void> {
    await this.updateCommand(repoRoot, paths, false);
  }

  async sync(repoRoot: string, paths: readonly string[] = []): Promise<void> {
    const args = ['submodule', 'sync', '--recursive', ...pathArgs(paths)];
    log.info(paths.length > 0 ? `sync submodules ${paths.join(', ')}` : 'sync submodules');
    await this.cli(repoRoot).execWrite(args);
  }

  /** Checks out recorded submodule commits. No-ops when the repo has none. */
  async updateIfPresent(repoRoot: string): Promise<void> {
    await updateSubmodulesIfPresent(this.cli(repoRoot));
  }

  private async updateCommand(
    repoRoot: string,
    paths: readonly string[],
    initialize: boolean,
  ): Promise<void> {
    const args = ['submodule', 'update'];
    if (initialize) {
      args.push('--init');
    }
    args.push('--recursive', ...pathArgs(paths));
    log.info(
      `${initialize ? 'init' : 'update'} submodules${paths.length > 0 ? ` ${paths.join(', ')}` : ''}`,
    );
    await this.cli(repoRoot).execWrite(args);
  }

  private cli(repoRoot: string): GitCli {
    return this.cliRegistry.getOrCreate(repoRoot);
  }
}

export async function updateSubmodulesIfPresent(cli: GitCli): Promise<void> {
  try {
    const sub = await cli.execRead(['submodule', 'status', '--recursive']);
    if (!sub.stdout.trim()) {
      return;
    }
    log.info('update submodules after history change');
    await cli.execWrite(['submodule', 'update', '--init', '--recursive']);
  } catch (error) {
    log.warn('submodule update after history change failed', error);
  }
}

function pathArgs(paths: readonly string[]): string[] {
  return paths.length > 0 ? ['--', ...paths] : [];
}
