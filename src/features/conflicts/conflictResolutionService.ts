import type { GitCli } from '../../core/gitCli';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import type { GitExtensionService } from '../../core/gitExtensionService';
import { RepoOperationService } from '../operations/repoOperationService';
import type { ConflictHelperStateDto } from '../../shared/conflicts/conflictProtocol';
import {
  abortGitCommand,
  buildConflictFiles,
  continueGitCommand,
  parsePorcelainV2Unmerged,
  wrapConflictIndex,
} from './conflictHelperModel';
import { updateSubmodulesIfPresent } from '../submodules/submoduleService';
import { createLogger } from '../../log';

const log = createLogger('conflict');

export class ConflictResolutionService {
  private readonly repoOperation: RepoOperationService;

  constructor(
    gitService: GitExtensionService,
    private readonly cliRegistry: GitCliRegistry,
  ) {
    this.repoOperation = new RepoOperationService(gitService, cliRegistry);
  }

  async loadState(repoRoot: string, selectedIndex = 0): Promise<ConflictHelperStateDto> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    // Three independent reads; the binary probe needs the first listing, so it comes after.
    const [operation, porcelain, lsFiles] = await Promise.all([
      this.repoOperation.getStatus(repoRoot),
      cli.execRead(['status', '--porcelain=v2', '-z']),
      cli.execRead(['ls-files', '-u']),
    ]);
    const binaryPaths = await this.listBinaryConflictPaths(cli, porcelain.stdout);
    const files = buildConflictFiles(porcelain.stdout, lsFiles.stdout, binaryPaths);
    const index = wrapConflictIndex(selectedIndex, files.length);
    const kind = operation.kind;
    return {
      repoRoot,
      operationKind: kind,
      operationSummary: operation.summary,
      files,
      selectedIndex: index,
      continueCommand: continueGitCommand(kind),
      abortCommand: abortGitCommand(kind),
      allResolved: files.length === 0,
    };
  }

  /**
   * Continues the operation. A rebase or a multi-commit pick can stop again at the next commit, and Git exits
   * non-zero then; that is progress, not a failure, so it is reported as `stopped`. `unresolved` means files
   * are still conflicted, so Git was not asked to continue.
   */
  async continue(repoRoot: string): Promise<'finished' | 'stopped' | 'unresolved'> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    const operation = await this.repoOperation.getStatus(repoRoot);
    if ((operation.conflictCount ?? 0) > 0) {
      return 'unresolved';
    }
    const args = continueArgs(operation.kind);
    try {
      await this.cliRegistry.runWrite(repoRoot, async () => {
        // Git opens an editor to confirm the commit message it prepared; there is no terminal here to show
        // one, so keep the message as it is.
        await cli.execWrite(args, { env: { GIT_EDITOR: 'true' } });
      });
    } catch (error) {
      const after = await this.repoOperation.getStatus(repoRoot);
      if (after.active && (after.conflictCount ?? 0) > 0) {
        log.info(`${args.join(' ')} stopped at the next step, which has conflicts`, error);
        return 'stopped';
      }
      throw error;
    }
    await updateSubmodulesIfPresent(cli);
    return 'finished';
  }

  async abort(repoRoot: string): Promise<void> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    const operation = await this.repoOperation.getStatus(repoRoot);
    const args = abortArgs(operation.kind);
    await this.cliRegistry.runWrite(repoRoot, async () => {
      await cli.execWrite(args);
    });
  }

  /**
   * Whether the two sides of a conflicted path are binary. A plain `git diff --numstat -- <path>` says
   * `0 0` for an unmerged path, so compare the index stages themselves: 2 is ours, 3 is theirs, and 1 is the
   * common ancestor, which stands in for a side that deleted the file.
   */
  private async isBinaryConflict(cli: GitCli, path: string): Promise<boolean> {
    for (const [left, right] of [[2, 3], [1, 3], [1, 2]]) {
      try {
        const result = await cli.execRead(['diff', '--numstat', `:${left}:${path}`, `:${right}:${path}`]);
        const line = result.stdout.split(/\r?\n/).find((l) => l.trim().length > 0);
        if (line !== undefined) {
          return line.startsWith('-');
        }
      } catch (error) {
        // That stage does not exist for this kind of conflict (for example, no ancestor for an added file).
        log.debug(`binary probe: stages ${left} and ${right} not comparable for ${path}`, error);
      }
    }
    return false;
  }

  private async listBinaryConflictPaths(cli: GitCli, porcelainOutput: string): Promise<string[]> {
    const paths = parsePorcelainV2Unmerged(porcelainOutput).map((e) => e.path);
    // One probe per conflicted file; they do not depend on each other, so run them together.
    const probed = await Promise.all(
      paths.map(async (path) => {
        return (await this.isBinaryConflict(cli, path)) ? path : undefined;
      }),
    );
    return probed.filter((path): path is string => path !== undefined);
  }
}

function continueArgs(kind: ConflictHelperStateDto['operationKind']): string[] {
  switch (kind) {
    case 'merge':
      return ['merge', '--continue'];
    case 'rebase':
      return ['rebase', '--continue'];
    case 'cherry-pick':
      return ['cherry-pick', '--continue'];
    case 'revert':
      return ['revert', '--continue'];
    default:
      return ['commit', '--no-edit'];
  }
}

function abortArgs(kind: ConflictHelperStateDto['operationKind']): string[] {
  switch (kind) {
    case 'merge':
      return ['merge', '--abort'];
    case 'rebase':
      return ['rebase', '--abort'];
    case 'cherry-pick':
      return ['cherry-pick', '--abort'];
    case 'revert':
      return ['revert', '--abort'];
    default:
      return ['merge', '--abort'];
  }
}
