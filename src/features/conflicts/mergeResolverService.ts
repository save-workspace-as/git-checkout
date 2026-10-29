import { readFile, writeFile } from 'node:fs/promises';
import type { GitCli } from '../../core/gitCli';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import { assertRepoRelativePath, toAbsoluteRepoPath } from '../changes/workingCopyModel';
import type { MergeSideDto } from '../../shared/conflicts/mergeProtocol';
import { createLogger } from '../../log';

const log = createLogger('merge-resolver');

/** What stands for the commit that is brought in, by the operation that is running. */
const INCOMING_HEADS = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD'];

export interface MergeResolverFile {
  text: string;
  /** The whole files of the two sides, from the index; nothing when the index does not have one of them. */
  ours?: string;
  theirs?: string;
  incoming: MergeSideDto;
  current: MergeSideDto;
}

export class MergeResolverService {
  constructor(private readonly cliRegistry: GitCliRegistry) {}

  /** The conflicted file as Git left it, and the two commits that conflict. */
  async load(repoRoot: string, path: string): Promise<MergeResolverFile> {
    const rel = assertRepoRelativePath(path);
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    const [text, current, incoming, ours, theirs] = await Promise.all([
      readFile(toAbsoluteRepoPath(repoRoot, rel), 'utf8'),
      this.describe(cli, 'HEAD'),
      this.describeIncoming(cli),
      this.tryShow(cli, `:2:${rel}`),
      this.tryShow(cli, `:3:${rel}`),
    ]);
    return { text, current, incoming, ...(ours === undefined || theirs === undefined ? {} : { ours, theirs }) };
  }

  /** Writes the resolved file and stages it, which is how Git is told the conflict is resolved. */
  async resolve(repoRoot: string, path: string, text: string): Promise<void> {
    const rel = assertRepoRelativePath(path);
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    await writeFile(toAbsoluteRepoPath(repoRoot, rel), text, 'utf8');
    await cli.execWrite(['add', '--', rel]);
  }

  private async describeIncoming(cli: GitCli): Promise<MergeSideDto> {
    for (const head of INCOMING_HEADS) {
      try {
        await cli.execRead(['rev-parse', '--verify', '--quiet', head]);
        return await this.describe(cli, head);
      } catch (error) {
        // The operation that is running does not have this head.
        log.debug(`${head} is not there`, error);
      }
    }
    return { label: '', subject: '', author: '', date: 0 };
  }

  private async describe(cli: GitCli, ref: string): Promise<MergeSideDto> {
    const result = await cli.execRead(['log', '-1', '--format=%H%x00%s%x00%an%x00%ct', ref]);
    const [sha = '', subject = '', author = '', date = '0'] = result.stdout.trim().split('\0');
    return { label: await this.labelOf(cli, ref, sha), subject, author, date: Number(date) || 0 };
  }

  /** The branch a ref is on, or the nearest name Git has for its commit, or its short hash. */
  private async labelOf(cli: GitCli, ref: string, sha: string): Promise<string> {
    if (ref === 'HEAD') {
      const branch = await this.tryRead(cli, ['symbolic-ref', '--short', '-q', 'HEAD']);
      if (branch) {
        return branch;
      }
    }
    const named = await this.tryRead(cli, [
      'name-rev', '--name-only', '--no-undefined', '--refs=refs/heads/*', '--refs=refs/remotes/*', sha,
    ]);
    // Git suffixes a name with how far the commit is from it: `topic~2`. A commit that is a branch tip has none.
    if (named && !/[~^]/.test(named)) {
      return named.replace(/^remotes\//, '');
    }
    return sha.slice(0, 7);
  }

  /** A file of the index, which a conflict that one side added or deleted has only one of. */
  private async tryShow(cli: GitCli, spec: string): Promise<string | undefined> {
    try {
      return (await cli.execRead(['show', spec])).stdout;
    } catch (error) {
      log.debug(`${spec} is not in the index`, error);
      return undefined;
    }
  }

  private async tryRead(cli: GitCli, args: string[]): Promise<string | undefined> {
    try {
      const out = (await cli.execRead(args)).stdout.trim();
      return out || undefined;
    } catch (error) {
      // A detached HEAD has no branch, and a commit may have no name: the caller falls back.
      log.debug(`${args[0]} had nothing to say`, error);
      return undefined;
    }
  }
}
