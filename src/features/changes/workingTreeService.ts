import type { GitCliRegistry } from '../../core/gitCliRegistry';
import type { GitExtensionService } from '../../core/gitExtensionService';
import type { Repository } from '../../core/vscodeGitApi';
import { parseGitlinkPaths } from '../submodules/submoduleParser';
import {
  assertRepoRelativePath,
  buildWorkingCopyEntries,
  isStagedPath,
  parseLsFilesFlags,
  parsePorcelainChanges,
  parseUnmergedPaths,
  toAbsoluteRepoPath,
  withConflicts,
} from './workingCopyModel';
import type { WorktreeStatusDto } from '../../shared/changes/dailyGitProtocol';
import {
  EMPTY_WORKING_COPY,
  type WorkingCopyAction,
  type WorkingCopyEntryDto,
  type WorkingCopySnapshotDto,
} from '../../shared/changes/workingCopyProtocol';
import { createLogger } from '../../log';
import { RepositoryNotOpenError } from '../../core/repositoryNotOpenError';

const log = createLogger('working-tree');

/** A command line has a length limit, so a very large selection is staged in several commands. */
export const MAX_PATHS_PER_COMMAND = 200;

function chunked<T>(items: readonly T[], size = MAX_PATHS_PER_COMMAND): T[][] {
  const chunks: T[][] = [];
  for (let start = 0; start < items.length; start += size) {
    chunks.push(items.slice(start, start + size));
  }
  return chunks;
}

/** For the log: the path itself, or how many there are. */
function describePaths(paths: readonly string[]): string {
  return paths.length === 1 ? paths[0] : `${paths.length} files`;
}

const EMPTY: WorktreeStatusDto = { dirty: false, stagedCount: 0, unstagedCount: 0 };

export class WorkingTreeService {
  constructor(
    private readonly gitService: GitExtensionService,
    private readonly cliRegistry: GitCliRegistry,
  ) {}

  async getStatus(repoRoot: string): Promise<WorktreeStatusDto> {
    const repo = this.gitService.getRepositories().find((r) => r.rootUri.fsPath === repoRoot);
    if (!repo) {
      return EMPTY;
    }

    const cli = this.cliRegistry.forRepository(repo);
    const result = await cli.execRead(['status', '--porcelain']);
    return parsePorcelainStatus(result.stdout);
  }

  async listChanges(repoRoot: string): Promise<WorkingCopyEntryDto[]> {
    const repo = this.gitService.getRepositories().find((r) => r.rootUri.fsPath === repoRoot);
    if (!repo) {
      return [];
    }
    const cli = this.cliRegistry.forRepository(repo);
    const result = await cli.execRead(['status', '--porcelain=v1', '-z']);
    return parsePorcelainChanges(result.stdout);
  }

  /** Files git ignores; a folder that is ignored whole is one entry ending in a slash. */
  async listIgnored(repoRoot: string): Promise<WorkingCopyEntryDto[]> {
    const result = await this.cliRegistry
      .getOrCreate(repoRoot)
      .execRead(['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z']);
    return result.stdout
      .split('\0')
      .filter(Boolean)
      .map((path) => ({ path: path.replace(/\\/g, '/'), group: 'untracked' as const, status: 'ignored' as const }));
  }

  async loadSnapshot(repoRoot: string): Promise<WorkingCopySnapshotDto> {
    const repo = this.gitService.getRepositories().find((r) => r.rootUri.fsPath === repoRoot);
    if (!repo) {
      return EMPTY_WORKING_COPY;
    }

    const entries = buildWorkingCopyEntries(repoRoot, repo.state);
    const cli = this.cliRegistry.forRepository(repo);
    // Two views of the index that do not depend on each other: list them together.
    const [flags, { gitlinks, unmerged }] = await Promise.all([
      cli.execRead(['ls-files', '-v', '-z']).then(
        (result) => parseLsFilesFlags(result.stdout),
        (error: unknown) => {
          log.warn('ls-files -v failed; index flags omitted', error);
          return EMPTY_WORKING_COPY.flags;
        },
      ),
      cli.execRead(['ls-files', '--stage', '-z']).then(
        (result) => ({ gitlinks: parseGitlinkPaths(result.stdout), unmerged: parseUnmergedPaths(result.stdout) }),
        (error: unknown) => {
          log.warn('ls-files --stage failed; submodule and conflict markers omitted', error);
          return { gitlinks: new Set<string>(), unmerged: new Set<string>() };
        },
      ),
    ]);
    return {
      entries: withConflicts(entries, unmerged).map((entry) =>
        gitlinks.has(entry.path) ? { ...entry, submodule: true } : entry,
      ),
      flags,
      ...(repo.state.HEAD?.name ? { branch: repo.state.HEAD.name } : {}),
    };
  }

  async runAction(repoRoot: string, action: WorkingCopyAction): Promise<void> {
    switch (action.op) {
      case 'stage':
        await this.stageFile(repoRoot, action.path);
        return;
      case 'unstage':
        await this.unstageFile(repoRoot, action.path);
        return;
      case 'discard':
        await this.discardFile(repoRoot, action.path);
        return;
      case 'assumeUnchanged':
        await this.setAssumeUnchanged(repoRoot, action.path, action.enabled);
        return;
      case 'skipWorktree':
        await this.setSkipWorktree(repoRoot, action.path, action.enabled);
        return;
    }
  }

  /**
   * Runs the actions in order. Neighbors of the same kind become one Git command, so staging a hundred
   * files runs `git add` once, not a hundred times (each of which also made VS Code re-read the status).
   */
  async runActions(repoRoot: string, actions: readonly WorkingCopyAction[]): Promise<void> {
    let index = 0;
    while (index < actions.length) {
      const action = actions[index];
      if (action.op !== 'stage' && action.op !== 'unstage' && action.op !== 'discard') {
        await this.runAction(repoRoot, action);
        index += 1;
        continue;
      }
      let end = index;
      const paths: string[] = [];
      while (end < actions.length && actions[end].op === action.op) {
        paths.push((actions[end] as { path: string }).path);
        end += 1;
      }
      if (action.op === 'stage') {
        await this.stageFiles(repoRoot, paths);
      } else if (action.op === 'unstage') {
        await this.unstageFiles(repoRoot, paths);
      } else {
        await this.discardFiles(repoRoot, paths);
      }
      index = end;
    }
  }

  async stageFile(repoRoot: string, filePath: string): Promise<void> {
    await this.stageFiles(repoRoot, [filePath]);
  }

  async unstageFile(repoRoot: string, filePath: string): Promise<void> {
    await this.unstageFiles(repoRoot, [filePath]);
  }

  async discardFile(repoRoot: string, filePath: string): Promise<void> {
    await this.discardFiles(repoRoot, [filePath]);
  }

  async stageFiles(repoRoot: string, filePaths: readonly string[]): Promise<void> {
    const relative = filePaths.map(assertRepoRelativePath);
    const repo = this.requireRepository(repoRoot);
    log.info(`stage ${describePaths(relative)}`);
    for (const chunk of chunked(relative)) {
      await this.cliRegistry.runWrite(repoRoot, () =>
        repo.add(chunk.map((rel) => toAbsoluteRepoPath(repoRoot, rel))),
      );
    }
  }

  async unstageFiles(repoRoot: string, filePaths: readonly string[]): Promise<void> {
    const relative = filePaths.map(assertRepoRelativePath);
    const repo = this.requireRepository(repoRoot);
    log.info(`unstage ${describePaths(relative)}`);
    for (const chunk of chunked(relative)) {
      await this.cliRegistry.runWrite(repoRoot, () =>
        repo.revert(chunk.map((rel) => toAbsoluteRepoPath(repoRoot, rel))),
      );
    }
  }

  async discardFiles(repoRoot: string, filePaths: readonly string[]): Promise<void> {
    const relative = filePaths.map(assertRepoRelativePath);
    const repo = this.requireRepository(repoRoot);
    log.info(`discard ${describePaths(relative)}`);
    for (const chunk of chunked(relative)) {
      await this.cliRegistry.runWrite(repoRoot, async () => {
        const staged = chunk.filter((rel) => isStagedPath(repoRoot, repo.state, rel));
        if (staged.length > 0) {
          await repo.revert(staged.map((rel) => toAbsoluteRepoPath(repoRoot, rel)));
        }
        await repo.clean(chunk.map((rel) => toAbsoluteRepoPath(repoRoot, rel)));
      });
    }
  }

  async setAssumeUnchanged(repoRoot: string, filePath: string, enabled: boolean): Promise<void> {
    await this.setIndexFlag(
      repoRoot,
      filePath,
      enabled ? '--assume-unchanged' : '--no-assume-unchanged',
    );
  }

  async setSkipWorktree(repoRoot: string, filePath: string, enabled: boolean): Promise<void> {
    await this.setIndexFlag(
      repoRoot,
      filePath,
      enabled ? '--skip-worktree' : '--no-skip-worktree',
    );
  }

  async hasStagedChanges(repoRoot: string): Promise<boolean> {
    const repo = this.gitService.getRepositories().find((r) => r.rootUri.fsPath === repoRoot);
    if (!repo) {
      return false;
    }
    const cli = this.cliRegistry.forRepository(repo);
    try {
      await cli.execRead(['diff', '--cached', '--quiet']);
      return false;
    } catch (error) {
      log.debug('staged diff is non-empty or unavailable', error);
      return true;
    }
  }

  private async setIndexFlag(repoRoot: string, filePath: string, flag: string): Promise<void> {
    const rel = assertRepoRelativePath(filePath);
    this.requireRepository(repoRoot);
    log.info(`${flag} ${rel}`);
    await this.cliRegistry.runWrite(repoRoot, async () => {
      const cli = this.cliRegistry.getOrCreate(repoRoot);
      await cli.execWrite(['update-index', flag, '--', rel], { showErrorToast: true });
    });
  }

  private requireRepository(repoRoot: string): Repository {
    const repo = this.gitService.getRepositories().find((r) => r.rootUri.fsPath === repoRoot);
    if (!repo) {
      throw new RepositoryNotOpenError();
    }
    return repo;
  }
}

export function parsePorcelainStatus(output: string): WorktreeStatusDto {
  let stagedCount = 0;
  let unstagedCount = 0;

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const x = line[0] ?? ' ';
    const y = line[1] ?? ' ';
    if (x === '?' && y === '?') {
      unstagedCount++;
      continue;
    }
    if (x !== ' ' && x !== '?') {
      stagedCount++;
    }
    if (y !== ' ' && y !== '?') {
      unstagedCount++;
    }
  }

  const dirty = stagedCount > 0 || unstagedCount > 0;
  return { dirty, stagedCount, unstagedCount };
}
