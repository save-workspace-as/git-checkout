import type * as vscode from 'vscode';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import type { GitExecOptions } from '../../core/gitCli';
import { resolveRepositoryLayout } from '../../core/gitRepositoryLayout';
import { readRebaseSequencerState, type RebaseSequencerSnapshot } from './rebaseSequencerState';
import { checkRebaseReplayPreflight, type RebasePreflightResult } from './rebasePreflight';
import { writeTempRebaseTodo } from './sequenceEditor';
import {
  buildPickLines,
  commitLinesOnly,
  serializeRebaseTodo,
  type RebaseTodoLine,
} from './rebaseTodo';
import { withLeanStash } from '../branches/leanBranching';
import type { WorkingTreeService } from '../changes/workingTreeService';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as l10n from '@vscode/l10n';

export interface RebaseCommitInfo {
  hash: string;
  subject: string;
}

export interface InteractiveRebaseStartOptions {
  onto: string;
  upstream: string;
  lines: readonly RebaseTodoLine[];
  updateRefs?: boolean;
  autosquash?: boolean;
  stashDirty?: boolean;
  cancellationToken?: vscode.CancellationToken;
}

export interface InteractiveRebaseRunOptions {
  cancellationToken?: vscode.CancellationToken;
  stashDirty?: boolean;
}

export class InteractiveRebaseService {
  constructor(
    private readonly cliRegistry: GitCliRegistry,
    private readonly workingTree: WorkingTreeService,
  ) {}

  async listRebaseCommits(repoRoot: string, upstream: string): Promise<RebaseCommitInfo[]> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    const result = await cli.execRead([
      'log',
      '--reverse',
      '--format=%H %s',
      `${upstream}..HEAD`,
    ]);
    const commits: RebaseCommitInfo[] = [];
    for (const line of result.stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const space = trimmed.indexOf(' ');
      if (space <= 0) {
        continue;
      }
      commits.push({
        hash: trimmed.slice(0, space),
        subject: trimmed.slice(space + 1),
      });
    }
    return commits;
  }

  async defaultUpstream(repoRoot: string, onto: string): Promise<string> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    return (await cli.execRead(['merge-base', onto, 'HEAD'])).stdout.trim();
  }

  async buildDefaultTodo(repoRoot: string, upstream: string): Promise<RebaseTodoLine[]> {
    const commits = await this.listRebaseCommits(repoRoot, upstream);
    return buildPickLines(commits);
  }

  async readSequencer(repoRoot: string): Promise<RebaseSequencerSnapshot | null> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    const layout = await resolveRepositoryLayout(cli, repoRoot);
    return readRebaseSequencerState(layout.gitDir);
  }

  async preflight(
    repoRoot: string,
    onto: string,
    lines: readonly RebaseTodoLine[],
  ): Promise<RebasePreflightResult> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    const picks = commitLinesOnly(lines).filter((l) => l.command !== 'drop');
    const shas = picks.map((l) => l.hash);
    return checkRebaseReplayPreflight(cli, onto, shas);
  }

  async start(repoRoot: string, options: InteractiveRebaseStartOptions): Promise<void> {
    const run = async () => {
      const cli = this.cliRegistry.getOrCreate(repoRoot);
      const layout = await resolveRepositoryLayout(cli, repoRoot);
      const messageDir = path.join(layout.gitDir, 'git-checkout-rebase-messages');
      for (const line of options.lines) {
        if (line.kind === 'commit' && line.command === 'reword' && line.message !== undefined
          && (!line.message.trim() || line.message.includes('\0'))) {
          throw new Error(l10n.t('Enter a non-empty commit message without null characters.'));
        }
      }
      const lines: RebaseTodoLine[] = [];
      for (const [index, line] of options.lines.entries()) {
        if (line.kind !== 'commit' || line.command !== 'reword' || line.message === undefined) {
          lines.push(line);
          continue;
        }
        fs.mkdirSync(messageDir, { recursive: true });
        const messagePath = path.join(messageDir, `${index}.txt`);
        fs.writeFileSync(messagePath, line.message, { mode: 0o600 });
        const shellPath = messagePath.split(path.sep).join('/');
        const quoted = `'${shellPath.replace(/'/g, "'\\''")}'`;
        lines.push({ ...line, command: 'pick' }, {
          kind: 'exec', command: 'exec',
          argument: `git commit --amend --allow-empty --no-edit -F ${quoted}`,
        });
      }
      const todo = serializeRebaseTodo(lines);
      const { sequenceEditor } = writeTempRebaseTodo(todo);
      const args = ['rebase', '-i'];
      if (options.updateRefs) {
        args.push('--update-refs');
      }
      if (options.autosquash) {
        args.push('--autosquash');
      }
      args.push('--onto', options.onto, options.upstream);
      const execOpts = this.execOptions(options.cancellationToken, {
        GIT_SEQUENCE_EDITOR: sequenceEditor,
      });
      // execWrite already takes the repo write lock. Wrapping it in runWrite deadlocks the queue.
      await cli.execWrite(args, execOpts);
      await this.cleanupMessages(repoRoot);
    };

    await this.maybeWithStash(repoRoot, options.stashDirty ?? false, run);
  }

  async continue(repoRoot: string, options?: InteractiveRebaseRunOptions): Promise<void> {
    await this.runRebaseCommand(repoRoot, ['rebase', '--continue'], options);
  }

  async skip(repoRoot: string, options?: InteractiveRebaseRunOptions): Promise<void> {
    await this.runRebaseCommand(repoRoot, ['rebase', '--skip'], options);
  }

  async abort(repoRoot: string, options?: InteractiveRebaseRunOptions): Promise<void> {
    await this.runRebaseCommand(repoRoot, ['rebase', '--abort'], options);
  }

  private async runRebaseCommand(
    repoRoot: string,
    args: string[],
    options?: InteractiveRebaseRunOptions,
  ): Promise<void> {
    const run = async () => {
      const cli = this.cliRegistry.getOrCreate(repoRoot);
      const execOpts = this.execOptions(options?.cancellationToken);
      await cli.execWrite(args, execOpts);
      await this.cleanupMessages(repoRoot);
    };
    await this.maybeWithStash(repoRoot, options?.stashDirty ?? false, run);
  }

  private async cleanupMessages(repoRoot: string): Promise<void> {
    if ((await this.readSequencer(repoRoot))?.active) { return; }
    const layout = await resolveRepositoryLayout(this.cliRegistry.getOrCreate(repoRoot), repoRoot);
    fs.rmSync(path.join(layout.gitDir, 'git-checkout-rebase-messages'), { recursive: true, force: true });
  }

  private async maybeWithStash(
    repoRoot: string,
    stashDirty: boolean,
    fn: () => Promise<void>,
  ): Promise<void> {
    const cli = this.cliRegistry.getOrCreate(repoRoot);
    await withLeanStash(repoRoot, stashDirty, this.workingTree, cli, fn);
  }

  private execOptions(
    token?: vscode.CancellationToken,
    env?: Record<string, string>,
  ): GitExecOptions {
    return {
      cancellationToken: token,
      showErrorToast: true,
      env,
    };
  }
}
