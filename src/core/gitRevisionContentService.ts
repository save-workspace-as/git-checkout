import type { GitCliRegistry } from './gitCliRegistry';
import type { GitExtensionService } from './gitExtensionService';
import { gitShowObjectSpec } from './gitCheckoutUri';
import { createLogger } from '../log';
import { RepositoryNotOpenError } from './repositoryNotOpenError';

const log = createLogger('git-revision-content');

export class GitRevisionContentService {
  constructor(
    private readonly gitService: GitExtensionService,
    private readonly cliRegistry: GitCliRegistry,
  ) {}

  async readFileAtRevision(
    repoRoot: string,
    revision: string,
    repoRelativePath: string,
  ): Promise<string> {
    const repo = this.gitService.getRepositories().find((r) => r.rootUri.fsPath === repoRoot);
    if (!repo) {
      throw new RepositoryNotOpenError();
    }
    const rel = repoRelativePath.replace(/\\/g, '/');
    const spec = gitShowObjectSpec(revision, rel);
    const cli = this.cliRegistry.forRepository(repo);
    try {
      const result = await cli.execRead(['show', spec]);
      return result.stdout;
    } catch (error) {
      log.warn(`git show failed for ${spec}`, error);
      throw error;
    }
  }
}
