import { createLogger } from '../../log';
import { GitCliError } from '../../core/gitCliError';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import { parseGitBlame, type BlameLine } from './gitBlameParser';
import { blameEndLine, buildBlameArgs, buildBlameRangesArgs, lineRanges, toBlameLineDtos } from './blameQuery';
import { BLAME_LINE_BATCH, type BlameLineDto, type BlameLinesPage } from '../../shared/history/blameProtocol';

const log = createLogger('blame');

interface LineCache {
  lines: BlameLine[];
  complete: boolean;
}

export interface BlameLinesRequest {
  path: string;
  revision: string;
  startLine: number;
}

function lineKey(repoRoot: string, revision: string, path: string): string {
  return `${repoRoot}\0${revision}\0${path}`;
}

export class BlameService {
  private readonly linesCache = new Map<string, LineCache>();

  constructor(
    private readonly cliRegistry: GitCliRegistry,
    private readonly lineBatch = BLAME_LINE_BATCH,
  ) {}

  invalidate(repoRoot?: string): void {
    if (!repoRoot) {
      this.linesCache.clear();
      return;
    }
    const prefix = `${repoRoot}\0`;
    for (const key of this.linesCache.keys()) {
      if (key.startsWith(prefix)) {
        this.linesCache.delete(key);
      }
    }
  }

  async loadLines(repoRoot: string, request: BlameLinesRequest): Promise<BlameLinesPage> {
    const path = request.path.replace(/\\/g, '/');
    const revision = request.revision.trim();
    const startLine = Math.max(1, Math.floor(request.startLine));
    const key = lineKey(repoRoot, revision, path);
    const entry = this.linesCache.get(key) ?? { lines: [], complete: false };
    this.linesCache.set(key, entry);

    while (!this.covers(entry, startLine)) {
      const before = entry.lines.length;
      await this.fetchLineBatch(repoRoot, revision, path, entry);
      if (entry.complete || entry.lines.length === before) {
        break;
      }
    }
    return this.pageFrom(entry, startLine);
  }

  /** Only the given lines of the file at `revision`, in one call; for the lines a diff shows. */
  async loadLineNumbers(repoRoot: string, revision: string, path: string, lines: readonly number[]): Promise<BlameLineDto[]> {
    const ranges = lineRanges(lines);
    if (ranges.length === 0) {
      return [];
    }
    const result = await this.cliRegistry.getOrCreate(repoRoot).execRead(buildBlameRangesArgs(revision, path, ranges));
    return toBlameLineDtos(parseGitBlame(result.stdout));
  }

  private covers(entry: LineCache, startLine: number): boolean {
    if (entry.complete) {
      return true;
    }
    const startIndex = entry.lines.findIndex((line) => line.finalLine >= startLine);
    if (startIndex < 0) {
      return false;
    }
    return entry.lines.length - startIndex >= this.lineBatch;
  }

  private pageFrom(entry: LineCache, startLine: number): BlameLinesPage {
    const startIndex = entry.lines.findIndex((line) => line.finalLine >= startLine);
    if (startIndex < 0) {
      return { lines: [], hasMore: false };
    }
    const slice = entry.lines.slice(startIndex, startIndex + this.lineBatch);
    const previousSha = startIndex > 0 ? entry.lines[startIndex - 1]?.sha : undefined;
    const hasMore = startIndex + slice.length < entry.lines.length || !entry.complete;
    return { lines: toBlameLineDtos(slice, previousSha), hasMore };
  }

  private async fetchLineBatch(
    repoRoot: string,
    revision: string,
    path: string,
    entry: LineCache,
  ): Promise<void> {
    const start = entry.lines.length > 0 ? entry.lines[entry.lines.length - 1].finalLine + 1 : 1;
    const end = start + this.lineBatch - 1;
    log.debug(`blame ${path} ${revision || 'WORKTREE'} L${start},${end}`);
    try {
      const result = await this.cliRegistry
        .getOrCreate(repoRoot)
        .execRead(buildBlameArgs(revision, path, start, end));
      const parsed = parseGitBlame(result.stdout);
      if (parsed.length === 0) {
        entry.complete = true;
        return;
      }
      const seen = new Set(entry.lines.map((line) => line.finalLine));
      let added = 0;
      for (const line of parsed) {
        if (!seen.has(line.finalLine)) {
          entry.lines.push(line);
          seen.add(line.finalLine);
          added++;
        }
      }
      if (added === 0 || parsed.length < this.lineBatch) {
        entry.complete = true;
      }
    } catch (error) {
      const stderr = error instanceof GitCliError ? error.stderr : '';
      const count = blameEndLine(stderr);
      if (count !== undefined && count < start) {
        log.debug(`blame range starts after the end of ${path}`, error);
        entry.complete = true;
        return;
      }
      throw error;
    }
  }
}
