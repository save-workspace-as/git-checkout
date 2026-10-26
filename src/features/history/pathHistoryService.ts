import { createLogger } from '../../log';
import type { GraphCommitDto } from '../../shared/graph/graphProtocol';
import { parseGitLog } from '../../core/gitLogParser';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import { buildPathHistoryLogArgs, buildResetFileArgs, buildResetPreviewArgs } from './pathHistoryQuery';
import {
  PATH_HISTORY_PAGE_SIZE,
  type PathHistoryPageDto,
  type PathHistoryRequest,
} from '../../shared/history/pathHistoryProtocol';

const log = createLogger('path-history');

function uniqueCommits(commits: GraphCommitDto[]): GraphCommitDto[] {
  const seen = new Set<string>();
  const unique: GraphCommitDto[] = [];
  for (const commit of commits) {
    if (seen.has(commit.sha)) {
      continue;
    }
    seen.add(commit.sha);
    unique.push(commit);
  }
  return unique;
}

export class PathHistoryService {
  constructor(private readonly cliRegistry: GitCliRegistry) {}

  async loadPage(repoRoot: string, request: PathHistoryRequest): Promise<PathHistoryPageDto> {
    const args = buildPathHistoryLogArgs(request);
    log.debug(`log ${request.scope} ${request.path} skip=${request.skip}`);
    const result = await this.cliRegistry.getOrCreate(repoRoot).execRead(args);
    const parsed = parseGitLog(result.stdout);
    const limit = request.limit ?? PATH_HISTORY_PAGE_SIZE;
    return {
      commits: uniqueCommits(parsed),
      hasMore: parsed.length === limit,
      advance: parsed.length,
    };
  }

  async diffStat(repoRoot: string, revision: string, path: string): Promise<string> {
    const result = await this.cliRegistry
      .getOrCreate(repoRoot)
      .execRead(buildResetPreviewArgs(revision, path));
    return result.stdout.trim();
  }

  async resetFile(repoRoot: string, revision: string, path: string): Promise<void> {
    const rel = path.replace(/\\/g, '/');
    log.info(`reset ${rel} to ${revision}`);
    await this.cliRegistry.runWrite(repoRoot, async () => {
      await this.cliRegistry.getOrCreate(repoRoot).execWrite(buildResetFileArgs(revision, rel), {
        showErrorToast: true,
      });
    });
  }
}
