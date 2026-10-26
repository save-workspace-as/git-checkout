import * as l10n from '@vscode/l10n';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createLogger } from '../../log';
import type { StashCreateRequest, StashEntryDto } from '../../shared/stash/stashProtocol';
import { GitCliError } from '../../core/gitCliError';
import type { GitCli } from '../../core/gitCli';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import {
    assertStashSelector,
    parseStashList,
    STASH_LIST_ARGS,
    stashDropOrder,
} from './stashParser';
import { assertRepoRelativePath } from '../changes/workingCopyModel';

const log = createLogger('stash');

export class StashService {
  constructor(private readonly cliRegistry: GitCliRegistry) {}

  async list(repoRoot: string): Promise<StashEntryDto[]> {
    const result = await this.cli(repoRoot).execRead(STASH_LIST_ARGS);
    return parseStashList(result.stdout);
  }

  async create(repoRoot: string, request: StashCreateRequest): Promise<void> {
    if (request.mode === 'patch') {
      await this.stashPatch(repoRoot, request.message, request.patch, request.side);
      return;
    }
    const args = ['stash', 'push'];
    if (request.mode === 'all' ? request.includeUntracked : true) {
      args.push('-u');
    }
    const message = request.message.trim();
    if (message) {
      args.push('-m', message);
    }
    if (request.mode === 'paths') {
      const paths = request.paths.map(assertRepoRelativePath);
      if (paths.length === 0) {
        throw new Error(l10n.t('Choose at least one file to stash.'));
      }
      args.push('--', ...paths);
    }
    log.info(`stash ${request.mode}`);
    await this.write(repoRoot, args);
  }

  async apply(repoRoot: string, selector: string, restoreIndex = true): Promise<void> {
    const target = assertStashSelector(selector);
    const cli = this.cli(repoRoot);
    const savedIndex = (await cli.execRead(['write-tree'])).stdout.trim();
    const args = ['stash', 'apply'];
    if (restoreIndex) {
      args.push('--index');
    }
    args.push(target);
    log.info(`apply ${target}`);
    try {
      await this.write(repoRoot, args, false);
    } catch (error) {
      if (!(error instanceof GitCliError)) {
        throw error;
      }
      if (/Aborting/i.test(error.stderr)) {
        await this.restoreIndexIfChanged(repoRoot, savedIndex);
        await this.restoreWithMerge(repoRoot, target);
        return;
      }
      if (/Index was not unstashed/i.test(error.stderr)) {
        log.warn(`stash index was not restored for ${target}`, error);
        return;
      }
      throw error;
    }
  }

  async pop(repoRoot: string, selector: string): Promise<void> {
    const target = assertStashSelector(selector);
    await this.apply(repoRoot, target, true);
    await this.drop(repoRoot, [target]);
  }

  async drop(repoRoot: string, selectors: readonly string[]): Promise<void> {
    for (const selector of stashDropOrder(selectors)) {
      log.info(`drop ${selector}`);
      await this.write(repoRoot, ['stash', 'drop', selector]);
    }
  }

  async rename(repoRoot: string, selector: string, message: string): Promise<void> {
    const target = assertStashSelector(selector);
    const stash = (await this.list(repoRoot)).find((entry) => entry.selector === target);
    if (!stash) {
      throw new Error(l10n.t('Stash not found: {0}', target));
    }
    const updatedMessage = message.trim();
    if (!updatedMessage) {
      throw new Error(l10n.t('Stash message is required.'));
    }
    if (stash.index === 0) {
      await this.drop(repoRoot, [target]);
      try {
        await this.write(repoRoot, ['stash', 'store', '-m', updatedMessage, stash.sha]);
      } catch (error) {
        try {
          await this.write(repoRoot, ['stash', 'store', '-m', stash.message, stash.sha]);
        } catch (restoreError) {
          log.error('could not restore stash after a failed rename', restoreError);
        }
        throw error;
      }
      return;
    }
    await this.write(repoRoot, ['stash', 'store', '-m', updatedMessage, stash.sha]);
    await this.drop(repoRoot, [`stash@{${stash.index + 1}}`]);
  }

  async clear(repoRoot: string): Promise<void> {
    log.info('clear stashes');
    await this.write(repoRoot, ['stash', 'clear']);
  }

  async showPatch(repoRoot: string, selector: string): Promise<string> {
    const target = assertStashSelector(selector);
    const result = await this.cli(repoRoot).execRead(['stash', 'show', '-p', target]);
    return result.stdout;
  }

  private async stashPatch(
    repoRoot: string,
    message: string,
    patch: string,
    side: 'staged' | 'unstaged',
  ): Promise<void> {
    if (!patch.trim()) {
      throw new Error(l10n.t('Nothing to stash for this selection.'));
    }
    const cli = this.cli(repoRoot);
    const saved = (await cli.execRead(['write-tree'])).stdout.trim();
    const label = message.trim();
    let stashed = false;
    try {
      if (side === 'staged') {
        await cli.execWriteWithInput(
          ['apply', '--cached', '--reverse', '--whitespace=nowarn'],
          patch,
          { showErrorToast: false },
        );
      }
      const restoreIndex =
        side === 'staged' ? (await cli.execRead(['write-tree'])).stdout.trim() : saved;
      await cli.execWrite(['read-tree', '--reset', 'HEAD'], { showErrorToast: false });
      await cli.execWriteWithInput(['apply', '--cached', '--whitespace=nowarn'], patch, {
        showErrorToast: false,
      });
      const args = ['stash', 'push', '--staged'];
      if (label) {
        args.push('-m', label);
      }
      log.info(`stash patch ${side}`);
      await cli.execWrite(args, { showErrorToast: false });
      stashed = true;
      await cli.execWrite(['read-tree', '--reset', restoreIndex], { showErrorToast: false });
      if (side === 'unstaged') {
        await this.rewriteUnstagedStash(repoRoot, label);
      }
    } catch (error) {
      if (!stashed) {
        try {
          await cli.execWrite(['read-tree', '--reset', saved], { showErrorToast: false });
        } catch (restoreError) {
          log.error('could not restore the index after a failed partial stash', restoreError);
        }
      }
      throw error;
    }
  }

  /**
   * `stash push --staged` records the hunk as an index change. Rewrite that entry so
   * an unstaged selection comes back unstaged, while `apply --index` still works.
   */
  private async rewriteUnstagedStash(repoRoot: string, label: string): Promise<void> {
    const cli = this.cli(repoRoot);
    const head = (await cli.execRead(['rev-parse', '--verify', 'HEAD'])).stdout.trim();
    const headTree = (await cli.execRead(['rev-parse', `${head}^{tree}`])).stdout.trim();
    const wipTree = (await cli.execRead(['rev-parse', 'stash@{0}^{tree}'])).stdout.trim();
    const branch = (await cli.execRead(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();
    const summary = label || 'WIP';
    const indexCommit = (
      await cli.execRead([
        'commit-tree',
        headTree,
        '-p',
        head,
        '-m',
        `index on ${branch}: ${summary}`,
      ])
    ).stdout.trim();
    const stashCommit = (
      await cli.execRead([
        'commit-tree',
        wipTree,
        '-p',
        head,
        '-p',
        indexCommit,
        '-m',
        `On ${branch}: ${summary}`,
      ])
    ).stdout.trim();
    await cli.execWrite(['stash', 'store', '-m', summary, stashCommit], { showErrorToast: false });
    await cli.execWrite(['stash', 'drop', 'stash@{1}'], { showErrorToast: false });
  }

  private async restoreIndexIfChanged(repoRoot: string, savedIndex: string): Promise<void> {
    const cli = this.cli(repoRoot);
    const current = (await cli.execRead(['write-tree'])).stdout.trim();
    if (current !== savedIndex) {
      await cli.execWrite(['read-tree', '--reset', savedIndex], { showErrorToast: false });
    }
  }

  private async restoreWithMerge(repoRoot: string, selector: string): Promise<void> {
    const cli = this.cli(repoRoot);
    const names = (
      await cli.execRead(['diff', '-z', '--name-only', `${selector}^1`, selector])
    ).stdout
      .split('\0')
      .map((name) => name.trim())
      .filter(Boolean);

    const dir = mkdtempSync(join(tmpdir(), 'git-checkout-stash-'));
    try {
      for (const name of names) {
        const rel = assertRepoRelativePath(name);
        const base = await this.showFile(cli, `${selector}^1:${rel}`);
        const theirs = await this.showFile(cli, `${selector}:${rel}`);
        const oursPath = join(repoRoot, rel);
        let ours = '';
        try {
          ours = readFileSync(oursPath, 'utf8');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
          }
          log.debug(`could not read existing contents of ${rel}`, error);
          ours = '';
        }
        const merged = await this.mergeFile(cli, dir, rel, ours, base ?? '', theirs ?? '');
        if (theirs === null && merged.length === 0) {
          try {
            rmSync(oursPath);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
              throw error;
            }
            // Already absent.
            log.debug(`could not remove absent stash path ${rel}`, error);
          }
          continue;
        }
        mkdirSync(dirname(oursPath), { recursive: true });
        writeFileSync(oursPath, merged);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    try {
      await cli.execRead(['rev-parse', '--verify', `${selector}^2`]);
      const indexDiff = await cli.execRead(['diff', `${selector}^1`, `${selector}^2`]);
      if (indexDiff.stdout.trim()) {
        await cli.execWriteWithInput(['apply', '--cached', '--whitespace=nowarn'], indexDiff.stdout, {
          showErrorToast: false,
        });
      }
    } catch (error) {
      log.warn(`could not restore staged state for ${selector}`, error);
    }
  }

  private async mergeFile(
    cli: GitCli,
    dir: string,
    rel: string,
    ours: string,
    base: string,
    theirs: string,
  ): Promise<string> {
    const slug = rel.replace(/[^\w.-]+/g, '_');
    const oursPath = join(dir, `${slug}.ours`);
    const basePath = join(dir, `${slug}.base`);
    const theirsPath = join(dir, `${slug}.theirs`);
    writeFileSync(oursPath, ours);
    writeFileSync(basePath, base);
    writeFileSync(theirsPath, theirs);
    try {
      await cli.execWrite(['merge-file', oursPath, basePath, theirsPath], { showErrorToast: false });
    } catch (error) {
      if (!(error instanceof GitCliError) || error.exitCode !== 1) {
        throw error;
      }
      log.debug(`merge-file reported a conflict while restoring ${rel}`, error);
      if (/binary/i.test(error.stderr)) {
        throw new Error(
          l10n.t('Cannot restore binary file {0} from the stash while it has other changes.', rel),
        );
      }
    }
    return readFileSync(oursPath, 'utf8');
  }

  private async showFile(cli: GitCli, revPath: string): Promise<string | null> {
    try {
      return (await cli.execRead(['show', revPath])).stdout;
    } catch (error) {
      log.debug(`could not read ${revPath} from stash`, error);
      return null;
    }
  }

  private cli(repoRoot: string): GitCli {
    return this.cliRegistry.getOrCreate(repoRoot);
  }

  private async write(repoRoot: string, args: string[], showErrorToast = true): Promise<void> {
    await this.cli(repoRoot).execWrite(args, { showErrorToast });
  }
}
