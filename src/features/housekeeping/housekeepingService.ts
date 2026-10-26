import type { GitCliRegistry } from '../../core/gitCliRegistry';
import { createLogger } from '../../log';
import { parseCleanPreview, parseMergedBranches, parsePrunable } from './housekeepingParsers';

const log = createLogger('housekeeping');

const GC_TIMEOUT_MS = 600_000;

/** Tidying a repository: stale remote-tracking branches, merged branches, untracked files and Git's own storage. */
export class HousekeepingService {
  constructor(private readonly cliRegistry: GitCliRegistry) {}

  async remotes(repoRoot: string): Promise<string[]> {
    const result = await this.cliRegistry.getOrCreate(repoRoot).execRead(['remote']);
    return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  }

  /** The remote-tracking branches of `remote` whose branch no longer exists there. Asks the remote. */
  async prunable(repoRoot: string, remote: string): Promise<string[]> {
    const result = await this.cliRegistry.getOrCreate(repoRoot).execRead(['remote', 'prune', '--dry-run', '--', remote], { network: true });
    return parsePrunable(result.stdout);
  }

  async prune(repoRoot: string, remote: string): Promise<void> {
    log.info(`prune ${remote} in ${repoRoot}`);
    await this.cliRegistry.getOrCreate(repoRoot).execWrite(['remote', 'prune', '--', remote], { network: true });
  }

  /** Local branches already merged into the current one, other than the current branch and the long-lived ones. */
  async mergedBranches(repoRoot: string): Promise<string[]> {
    const result = await this.cliRegistry.getOrCreate(repoRoot).execRead(['branch', '--no-color', '--merged', 'HEAD']);
    return parseMergedBranches(result.stdout);
  }

  /** Deletes with `-d`, so Git itself refuses a branch that is not fully merged. */
  async deleteBranches(repoRoot: string, names: readonly string[]): Promise<void> {
    log.info(`delete ${names.length} merged branches in ${repoRoot}`);
    await this.cliRegistry.getOrCreate(repoRoot).execWrite(['branch', '-d', '--', ...names]);
  }

  /** What `git clean` would delete: untracked files and folders, and ignored ones when asked. */
  async cleanPreview(repoRoot: string, includeIgnored: boolean): Promise<string[]> {
    const args = ['clean', '-n', '-d', ...(includeIgnored ? ['-x'] : [])];
    const result = await this.cliRegistry.getOrCreate(repoRoot).execRead(args);
    return parseCleanPreview(result.stdout);
  }

  async clean(repoRoot: string, paths: readonly string[], includeIgnored: boolean): Promise<void> {
    log.info(`clean ${paths.length} paths in ${repoRoot}`);
    await this.cliRegistry.getOrCreate(repoRoot).execWrite(['clean', '-f', '-d', ...(includeIgnored ? ['-x'] : []), '--', ...paths]);
  }

  /** The top-level folders of the checked-out commit. */
  async topLevelFolders(repoRoot: string): Promise<string[]> {
    const result = await this.cliRegistry.getOrCreate(repoRoot).execRead(['ls-tree', '-d', '--name-only', '-z', 'HEAD']);
    return result.stdout.split('\0').filter(Boolean);
  }

  /** The folders a sparse checkout keeps, or none when it is off. */
  async sparseFolders(repoRoot: string): Promise<string[]> {
    try {
      const result = await this.cliRegistry.getOrCreate(repoRoot).execRead(['sparse-checkout', 'list']);
      return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    } catch (error) {
      // Git exits with an error when sparse checkout was never turned on, which is the normal case.
      log.debug('sparse checkout is not enabled', error);
      return [];
    }
  }

  async setSparseFolders(repoRoot: string, folders: readonly string[]): Promise<void> {
    log.info(`sparse checkout of ${folders.length} folders in ${repoRoot}`);
    await this.cliRegistry.getOrCreate(repoRoot).execWrite(['sparse-checkout', 'set', '--cone', '--', ...folders]);
  }

  async disableSparse(repoRoot: string): Promise<void> {
    await this.cliRegistry.getOrCreate(repoRoot).execWrite(['sparse-checkout', 'disable']);
  }

  async gc(repoRoot: string): Promise<void> {
    log.info(`gc in ${repoRoot}`);
    await this.cliRegistry.getOrCreate(repoRoot).execWrite(['gc'], { timeoutMs: GC_TIMEOUT_MS });
  }
}
