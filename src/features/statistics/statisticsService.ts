import type { GitCliRegistry } from '../../core/gitCliRegistry';
import { parseContributors, parseObjectSizes, type Contributor, type ObjectSizes } from './statisticsParsers';

export interface RepositoryStatistics {
  commits: number;
  branches: number;
  tags: number;
  /** Author date of the oldest root commit, ISO 8601, when the repository has one. */
  firstCommit?: string;
  contributors: Contributor[];
  sizes: ObjectSizes;
}

/** Counts that describe a repository: its size, its age and who wrote it. */
export class StatisticsService {
  constructor(private readonly cliRegistry: GitCliRegistry) {}

  async load(repoRoot: string): Promise<RepositoryStatistics> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    const lines = async (args: string[]): Promise<string[]> =>
      (await cli.execRead(args)).stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const [count, branches, tags, roots, contributors, sizes] = await Promise.all([
      cli.execRead(['rev-list', '--count', 'HEAD']),
      lines(['for-each-ref', '--format=%(refname)', 'refs/heads']),
      lines(['for-each-ref', '--format=%(refname)', 'refs/tags']),
      lines(['log', '--max-parents=0', '--format=%aI', 'HEAD']),
      cli.execRead(['shortlog', '-sne', 'HEAD']),
      cli.execRead(['count-objects', '-vH']),
    ]);
    return {
      commits: Number.parseInt(count.stdout.trim(), 10) || 0,
      branches: branches.length,
      tags: tags.length,
      firstCommit: roots.sort()[0],
      contributors: parseContributors(contributors.stdout),
      sizes: parseObjectSizes(sizes.stdout),
    };
  }
}
