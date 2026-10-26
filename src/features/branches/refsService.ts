import type { GitCli } from '../../core/gitCli';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import type { GitExtensionService } from '../../core/gitExtensionService';
import type { CommitGraphService } from '../graph/commitGraphService';
import {
  loadRemoteUrls,
  parseLocalBranches,
  parseRemoteBranches,
  parseRemoteNames,
  parseRevListLeftRightCount,
  parseTags,
} from '../../core/gitRefParser';
import type { RefsCompareResultDto, RefsSnapshotDto } from '../../shared/branches/refsProtocol';
import { RepositoryNotOpenError } from '../../core/repositoryNotOpenError';

const BRANCH_FORMAT =
  '%(refname:short)%00%(objectname:short)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)';
const REMOTE_BRANCH_FORMAT = '%(refname:short)%00%(objectname:short)';
const TAG_FORMAT = '%(refname:short)%00%(objectname:short)%00%(objecttype)';

export class RefsService {
  constructor(
    private readonly gitService: GitExtensionService,
    private readonly cliRegistry: GitCliRegistry,
    private readonly graphService: CommitGraphService,
  ) {}

  async loadSnapshot(repoRoot: string): Promise<RefsSnapshotDto> {
    const cli = this.cliForRoot(repoRoot);
    const headRef = this.graphService.resolveHeadRef(repoRoot);

    const [branchOut, remoteBranchOut, tagOut, remoteListOut] = await Promise.all([
      cli.execRead([
        'for-each-ref',
        '--sort=-committerdate',
        'refs/heads/',
        `--format=${BRANCH_FORMAT}`,
      ]),
      cli.execRead([
        'for-each-ref',
        '--sort=-committerdate',
        'refs/remotes/',
        `--format=${REMOTE_BRANCH_FORMAT}`,
      ]),
      cli.execRead([
        'for-each-ref',
        '--sort=-creatordate',
        'refs/tags/',
        `--format=${TAG_FORMAT}`,
      ]),
      cli.execRead(['remote']),
    ]);

    const remoteNames = parseRemoteNames(remoteListOut.stdout);
    const remotes = await loadRemoteUrls(cli, remoteNames);

    return {
      branches: parseLocalBranches(branchOut.stdout, headRef),
      remoteBranches: parseRemoteBranches(remoteBranchOut.stdout),
      tags: parseTags(tagOut.stdout),
      remotes,
      filterRef: this.graphService.getFilterRef(repoRoot),
      headRef,
    };
  }

  async compareBranches(
    repoRoot: string,
    base: string,
    compare: string,
  ): Promise<RefsCompareResultDto> {
    const cli = this.cliForRoot(repoRoot);
    const range = `${base}...${compare}`;

    const [countResult, logResult, diffResult] = await Promise.all([
      cli.execRead(['rev-list', '--left-right', '--count', range]),
      cli.execRead(['log', '--oneline', '-n', '15', `${base}..${compare}`]),
      cli.execRead(['diff', '--shortstat', range]),
    ]);

    const { left, right } = parseRevListLeftRightCount(countResult.stdout);

    return {
      base,
      compare,
      leftCount: left,
      rightCount: right,
      logPreview: logResult.stdout.trim(),
      diffStat: diffResult.stdout.trim(),
    };
  }

  private cliForRoot(repoRoot: string): GitCli {
    const repo = this.gitService.getRepositories().find((r) => r.rootUri.fsPath === repoRoot);
    if (!repo) {
      throw new RepositoryNotOpenError();
    }
    return this.cliRegistry.forRepository(repo);
  }
}
