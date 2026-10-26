import { createLogger } from '../../log';
import type { CommitTreePageDto, CommitTreeRevisionDto } from '../../shared/history/commitTreeProtocol';
import type { GitCliRegistry } from '../../core/gitCliRegistry';

const log = createLogger('commit-tree');

/** Parses `git ls-tree -r -z --name-only` output. */
export function parseLsTreeNames(output: string): string[] {
  if (!output) {
    return [];
  }
  const paths: string[] = [];
  for (const record of output.split('\0')) {
    if (!record) {
      continue;
    }
    paths.push(record.replace(/\\/g, '/'));
  }
  return paths;
}

/** Parses `git log -1 --format=%H%x00%an%x00%ae%x00%at%x00%s`. */
export function parseRevisionCommit(output: string): CommitTreeRevisionDto | undefined {
  const [sha = '', author = '', email = '', date = '', subject = ''] = output.replace(/\n+$/, '').split('\0');
  if (!/^[0-9a-f]{40,64}$/i.test(sha)) {
    return undefined;
  }
  return { sha, author, email, date: Number.parseInt(date, 10) || 0, subject };
}

export class CommitTreeService {
  constructor(private readonly cliRegistry: GitCliRegistry) {}

  /** Every file at `revision`, and the commit it names. */
  async list(repoRoot: string, revision: string): Promise<CommitTreePageDto> {
    const rev = revision.trim() || 'HEAD';
    const [paths, commit] = await Promise.all([this.loadPaths(repoRoot, rev), this.readCommit(repoRoot, rev)]);
    return { revision: rev, paths, ...(commit ? { commit } : {}) };
  }

  /** The commit a revision (a branch, tag or hash) points at, or undefined when it names none. */
  async readCommit(repoRoot: string, revision: string): Promise<CommitTreeRevisionDto | undefined> {
    try {
      const result = await this.cliRegistry
        .getOrCreate(repoRoot)
        .execRead(['log', '-1', '--format=%H%x00%an%x00%ae%x00%at%x00%s', `${revision}^{commit}`]);
      return parseRevisionCommit(result.stdout);
    } catch (error) {
      log.debug(`no commit at ${revision}`, error);
      return undefined;
    }
  }

  private async loadPaths(repoRoot: string, revision: string): Promise<string[]> {
    const result = await this.cliRegistry.getOrCreate(repoRoot).execRead([
      'ls-tree',
      '-r',
      '-z',
      '--name-only',
      revision,
    ]);
    const paths = parseLsTreeNames(result.stdout);
    log.debug(`listed ${paths.length} paths at ${revision}`);
    return paths;
  }
}
