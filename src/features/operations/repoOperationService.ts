import * as l10n from '@vscode/l10n';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import type { GitExtensionService } from '../../core/gitExtensionService';
import { resolveRepositoryLayout } from '../../core/gitRepositoryLayout';
import { IDLE_REPO_OPERATION, type RepoOperationDto } from '../../shared/history/historyProtocol';
import { detectRepoOperationKind } from './repoOperationDetect';
import { createLogger } from '../../log';
import { readOperationDetails } from './operationDetails';

const log = createLogger('repo-operation');

export class RepoOperationService {
  constructor(
    private readonly gitService: GitExtensionService,
    private readonly cliRegistry: GitCliRegistry,
  ) {}

  async getStatus(repoRoot: string): Promise<RepoOperationDto> {
    const repo = this.gitService.getRepositories().find((r) => r.rootUri.fsPath === repoRoot);
    if (!repo) {
      return IDLE_REPO_OPERATION;
    }

    const cli = this.cliRegistry.forRepository(repo);
    // Where the repository keeps its state and which paths are unmerged do not depend on each other.
    const [layout, conflictCount] = await Promise.all([
      resolveRepositoryLayout(cli, repoRoot),
      cli.execRead(['diff', '--name-only', '--diff-filter=U']).then(
        (result) => result.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0).length,
        (error: unknown) => {
          log.debug('could not inspect unmerged paths', error);
          return 0;
        },
      ),
    ]);
    const gitDir = layout.gitDir;

    const kind = detectRepoOperationKind(gitDir);

    const active = kind !== null;
    const conflicted = conflictCount > 0;

    if (!active && !conflicted) {
      return IDLE_REPO_OPERATION;
    }

    const parts: string[] = [];
    if (kind) {
      const labels: Record<Exclude<typeof kind, null>, string> = {
        merge: l10n.t('Merge in progress'),
        rebase: l10n.t('Rebase in progress'),
        'cherry-pick': l10n.t('Cherry-pick in progress'),
        revert: l10n.t('Revert in progress'),
        bisect: l10n.t('Bisect in progress'),
      };
      parts.push(labels[kind]);
    }
    if (conflicted) {
      parts.push(
        conflictCount === 1
          ? l10n.t('1 conflicted file')
          : l10n.t('{0} conflicted files', conflictCount),
      );
    }

    return {
      active: active || conflicted,
      kind,
      conflicted,
      summary: parts.join(' · ') || l10n.t('Repository operation in progress'),
      conflictCount,
      ...readOperationDetails(gitDir, kind),
    };
  }
}
