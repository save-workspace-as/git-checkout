import { createLogger } from '../../log';
import { GitCliError } from '../../core/gitCliError';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import { parseGitBlame, type BlameLine } from './gitBlameParser';
import { ignoreRevsArgs } from '../blame/ignoreRevs';
import { parseFileHunks, previousLines } from './blameStepBack';
import { blameEndLine, buildBlameArgs, buildBlameRangesArgs, lineRanges, toBlameLineDtos } from './blameQuery';
import { BLAME_LINE_BATCH, type BlameLineDto, type BlameLinesPage } from '../../shared/history/blameProtocol';

const log = createLogger('blame');

/** A line's earlier life: the commit that last changed it before, and where the line was in that commit. */
export interface PreviousChange {
  sha: string;
  path: string;
  line: number;
}

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
    /** Whether `.git-blame-ignore-revs` is used; the setting, read each time. */
    private readonly ignoreRevs: () => boolean = () => false,
  ) {}

  /** Runs a blame, and runs it again without the ignore file when git cannot read that file, as with a commit it does not have. */
  private async blame(repoRoot: string, build: (extra: string[]) => string[]): Promise<string> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    const extra = ignoreRevsArgs(repoRoot, this.ignoreRevs());
    if (extra.length === 0) {
      return (await cli.execRead(build([]))).stdout;
    }
    try {
      return (await cli.execRead(build(extra), { showErrorToast: false })).stdout;
    } catch (error) {
      log.warn('blame with the ignore file failed; blaming without it', error);
      return (await cli.execRead(build([]))).stdout;
    }
  }

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
    const stdout = await this.blame(repoRoot, (extra) => buildBlameRangesArgs(revision, path, ranges, extra));
    return toBlameLineDtos(parseGitBlame(stdout));
  }

  /**
   * The commit that last changed a line before `sha` did, for stepping back through a line's history. `line` is the
   * line's number in the file as `sha` left it, and `path` the file's name there. Undefined when the line was added by
   * `sha`, when `sha` is the first commit, or when git cannot tell.
   */
  async previousChange(repoRoot: string, sha: string, path: string, line: number): Promise<PreviousChange | undefined> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    let diff: string;
    try {
      diff = (await cli.execRead(['diff', '-U0', '-M', '--no-color', '--no-ext-diff', `${sha}^`, sha], { showErrorToast: false })).stdout;
    } catch (error) {
      // The first commit has no parent to compare with, so there is nothing before it.
      log.debug(`no earlier version of ${path} before ${sha}`, error);
      return undefined;
    }
    const file = parseFileHunks(diff, path);
    const range = file && previousLines(file.hunks, line);
    if (!file || !range) {
      return undefined;
    }
    const stdout = await this.blame(repoRoot, (extra) => ['blame', '--porcelain', ...extra, `-L${range.first},${range.last}`, `${sha}^`, '--', file.oldPath]);
    const newest = parseGitBlame(stdout).reduce<BlameLine | undefined>((best, entry) => (!best || entry.authorTime > best.authorTime ? entry : best), undefined);
    return newest && { sha: newest.sha, path: newest.path || file.oldPath, line: newest.originalLine };
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
      const stdout = await this.blame(repoRoot, (extra) => buildBlameArgs(revision, path, start, end, extra));
      const parsed = parseGitBlame(stdout);
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
