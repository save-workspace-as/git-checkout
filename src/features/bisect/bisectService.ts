import * as fs from 'fs';
import * as path from 'path';
import type { CancellationToken } from 'vscode';
import { createLogger } from '../../log';
import { IDLE_BISECT_STATE, type BisectMark, type BisectStateDto } from '../../shared/bisect/bisectProtocol';
import {
  bisectCurrentSha,
  bisectGitTerm,
  bisectSummary,
  collectBisectMarks,
  parseBisectRefLines,
  parseBisectTerms,
  type BisectTerms,
} from './bisectState';
import { GitCliError } from '../../core/gitCliError';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import type { GitExecOptions } from '../../core/gitCli';
import { resolveRepositoryLayout } from '../../core/gitRepositoryLayout';
import * as l10n from '@vscode/l10n';

const log = createLogger('bisect');

export interface BisectRunOptions {
  cancellationToken?: CancellationToken;
}

export class BisectService {
  constructor(private readonly cliRegistry: GitCliRegistry) {}

  async read(repoRoot: string): Promise<BisectStateDto> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    let gitDir: string;
    try {
      gitDir = (await resolveRepositoryLayout(cli, repoRoot)).gitDir;
    } catch (error) {
      log.warn('bisect state unavailable', error);
      return IDLE_BISECT_STATE;
    }

    const logPath = path.join(gitDir, 'BISECT_LOG');
    if (!fs.existsSync(logPath)) {
      return IDLE_BISECT_STATE;
    }

    const logText = readText(logPath);
    const expected = readText(path.join(gitDir, 'BISECT_EXPECTED_REV'));
    let head: string | null = null;
    try {
      head = (await cli.execRead(['rev-parse', 'HEAD'])).stdout;
    } catch (error) {
      log.warn('bisect could not read HEAD', error);
    }

    let refs: { sha: string; refname: string }[] = [];
    try {
      const listed = await cli.execRead([
        'for-each-ref',
        '--format=%(objectname) %(refname)',
        'refs/bisect',
      ]);
      refs = parseBisectRefLines(listed.stdout);
    } catch (error) {
      log.warn('bisect refs unavailable', error);
    }

    const marks = collectBisectMarks(logText, refs);
    const currentSha = bisectCurrentSha(expected, head);
    return {
      active: true,
      currentSha,
      firstBadSha: marks.firstBadSha,
      good: marks.good,
      bad: marks.bad,
      skip: marks.skip,
      summary: bisectSummary(true, currentSha, marks.firstBadSha, marks.onlySkipped),
    };
  }

  async start(repoRoot: string, bad: string, good: string, options?: BisectRunOptions): Promise<void> {
    const args = ['bisect', 'start'];
    if (bad) {
      args.push(bad);
    } else if (good) {
      throw new Error(l10n.t('Enter a bad revision before a good revision.'));
    }
    if (good) {
      args.push(good);
    }
    log.info('bisect start');
    await this.exec(repoRoot, args, options);
  }

  async mark(
    repoRoot: string,
    mark: BisectMark,
    rev?: string,
    options?: BisectRunOptions,
  ): Promise<void> {
    const term = bisectGitTerm(mark, await this.terms(repoRoot));
    const args = ['bisect', term];
    if (rev) {
      args.push(rev);
    }
    log.info(`bisect ${mark}`);
    await this.exec(repoRoot, args, options);
  }

  async reset(repoRoot: string, options?: BisectRunOptions): Promise<void> {
    log.info('bisect reset');
    await this.exec(repoRoot, ['bisect', 'reset'], options);
  }

  private async terms(repoRoot: string): Promise<BisectTerms> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    const gitDir = (await resolveRepositoryLayout(cli, repoRoot)).gitDir;
    return parseBisectTerms(readText(path.join(gitDir, 'BISECT_TERMS')));
  }

  private async exec(repoRoot: string, args: string[], options?: BisectRunOptions): Promise<void> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    const execOpts: GitExecOptions = {
      cancellationToken: options?.cancellationToken,
      showErrorToast: false,
    };
    // execWrite already takes the repo write lock. Wrapping it in runWrite deadlocks the queue.
    try {
      await cli.execWrite(args, execOpts);
    } catch (error) {
      // git exits 2 after a successful skip when every remaining commit was skipped.
      if (error instanceof GitCliError && error.exitCode === 2) {
        const state = await this.read(repoRoot);
        if (state.active) {
          log.info('bisect has no further commit to test');
          return;
        }
      }
      throw error;
    }
  }
}

function readText(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    log.debug(`could not read bisect state file ${filePath}`, error);
    return '';
  }
}
