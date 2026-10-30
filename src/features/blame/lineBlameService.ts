import { createHash } from 'node:crypto';
import { createLogger } from '../../log';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import { parseGitBlame } from '../history/gitBlameParser';
import { ignoreRevsArgs } from './ignoreRevs';
import { parseCommitInfo, type CommitInfo, type LineBlame } from './lineBlameFormat';

const log = createLogger('line-blame');
const MAX_FILES = 20;
const MAX_COMMITS = 200;

/** Blame of a whole file, by 1-based line number. */
export type FileBlame = ReadonlyMap<number, LineBlame>;

/** Blame for the line you are on and the commit behind it, kept so moving the cursor costs nothing. */
export class LineBlameService {
  private readonly files = new Map<string, FileBlame>();
  private readonly commits = new Map<string, CommitInfo>();

  constructor(
    private readonly cliRegistry: GitCliRegistry,
    /** Whether `.git-blame-ignore-revs` is used; the setting, read each time. */
    private readonly ignoreRevs: () => boolean = () => false,
  ) {}

  invalidate(repoRoot?: string): void {
    for (const key of [...this.files.keys()]) {
      if (!repoRoot || key.startsWith(`${repoRoot}\0`)) {
        this.files.delete(key);
      }
    }
    // A commit never changes, so the commits stay.
  }

  /**
   * Blame of the file in the working tree. Pass `contents` for an editor with unsaved edits, so the lines
   * you typed read as not committed and the rest keep their commits. Undefined when git cannot blame the
   * file, for instance one that is not tracked.
   */
  async blameFile(repoRoot: string, path: string, contents?: string): Promise<FileBlame | undefined> {
    const key = `${repoRoot}\0${path}\0${contents === undefined ? 'disk' : createHash('sha1').update(contents).digest('hex')}`;
    const cached = this.files.get(key);
    if (cached) {
      return cached;
    }
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    const run = (extra: readonly string[]) => {
      const args = ['blame', '--porcelain', ...extra, ...(contents === undefined ? [] : ['--contents', '-']), '--', path.replace(/\\/g, '/')];
      return contents === undefined
        ? cli.execRead(args, { showErrorToast: false })
        : cli.execWriteWithInput(args, contents, { showErrorToast: false });
    };
    const ignore = ignoreRevsArgs(repoRoot, this.ignoreRevs());
    let stdout: string;
    try {
      ({ stdout } = await run(ignore).catch((error: unknown) => {
        if (ignore.length === 0) {
          throw error;
        }
        // The ignore file can name commits this clone does not have; blame is still wanted without it.
        log.warn('blame with the ignore file failed; blaming without it', error);
        return run([]);
      }));
    } catch (error) {
      // An untracked or new file has no history to blame; that is expected while typing in one.
      log.debug('no blame for the file', error);
      return undefined;
    }
    const blame = new Map<number, LineBlame>();
    for (const line of parseGitBlame(stdout)) {
      blame.set(line.finalLine, {
        sha: line.sha,
        author: line.author,
        authorMail: line.authorMail,
        authorTime: line.authorTime,
        summary: line.summary,
        path: line.path,
        originalLine: line.originalLine,
      });
    }
    this.files.set(key, blame);
    while (this.files.size > MAX_FILES) {
      this.files.delete(this.files.keys().next().value as string);
    }
    return blame;
  }

  /** The whole message of a commit, for the hover. */
  async commit(repoRoot: string, sha: string): Promise<CommitInfo | undefined> {
    const key = `${repoRoot}\0${sha}`;
    const cached = this.commits.get(key);
    if (cached) {
      return cached;
    }
    try {
      const { stdout } = await this.cliRegistry
        .getOrCreate(repoRoot)
        .execRead(['show', '-s', '--format=%H%x00%an%x00%ae%x00%at%x00%B', sha, '--'], { showErrorToast: false });
      const info = parseCommitInfo(stdout);
      if (info) {
        this.commits.set(key, info);
        while (this.commits.size > MAX_COMMITS) {
          this.commits.delete(this.commits.keys().next().value as string);
        }
      }
      return info;
    } catch (error) {
      log.warn('could not read the commit', error);
      return undefined;
    }
  }
}
