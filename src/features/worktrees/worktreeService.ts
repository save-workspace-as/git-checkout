import * as path from 'path';

import { createLogger } from '../../log';
import type { GitWorktreeDto, WorktreeCreateRequest } from '../../shared/worktrees/worktreeProtocol';
import type { GitCli } from '../../core/gitCli';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import { parseWorktreeList, sameWorktreePath } from './worktreeParser';
import * as l10n from '@vscode/l10n';

const log = createLogger('worktree');

export class WorktreeService {
  constructor(private readonly cliRegistry: GitCliRegistry) {}

  async list(repoRoot: string): Promise<GitWorktreeDto[]> {
    const result = await this.cli(repoRoot).execRead(['worktree', 'list', '--porcelain']);
    return parseWorktreeList(result.stdout, repoRoot);
  }

  async add(repoRoot: string, request: WorktreeCreateRequest): Promise<void> {
    const destination = request.path.trim();
    if (!destination) {
      throw new Error(l10n.t('Choose a folder for the worktree.'));
    }
    if (
      sameWorktreePath(repoRoot, destination) ||
      sameWorktreePath(repoRoot, path.resolve(repoRoot, destination))
    ) {
      throw new Error(l10n.t('Choose a folder other than the current worktree.'));
    }
    const args = ['worktree', 'add'];
    const branch = request.newBranch?.trim();
    if (branch) {
      args.push('-b', branch);
    }
    args.push(destination);
    const startPoint = request.startPoint?.trim();
    if (startPoint) {
      args.push(startPoint);
    }
    log.info(branch ? `add worktree ${destination} on new branch ${branch}` : `add worktree ${destination}`);
    await this.cli(repoRoot).execWrite(args);
  }

  async remove(repoRoot: string, worktreePath: string, cleanupSubmodules: boolean): Promise<void> {
    if (sameWorktreePath(repoRoot, worktreePath)) {
      throw new Error(l10n.t('The current worktree cannot be deleted.'));
    }
    if (cleanupSubmodules) {
      log.info(`deinit submodules in ${worktreePath}`);
      await this.cli(repoRoot).execWrite([
        '-C',
        worktreePath,
        'submodule',
        'deinit',
        '--all',
        '--force',
      ]);
    }
    log.info(`remove worktree ${worktreePath}`);
    await this.cli(repoRoot).execWrite(['worktree', 'remove', worktreePath]);
  }

  private cli(repoRoot: string): GitCli {
    return this.cliRegistry.getOrCreate(repoRoot);
  }
}
