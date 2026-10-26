import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { GitCliError } from '../../core/gitCliError';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import type { GitExtensionService } from '../../core/gitExtensionService';
import { InteractiveRebaseService } from './interactiveRebaseService';
import { commitLinesOnly, type RebaseTodoLine } from './rebaseTodo';
import {
  applyAutosquashCommands,
  combineSelected,
  reorderCommitLines,
  squashLastN,
} from './rebaseTodoActions';
import { WorkingTreeService } from '../changes/workingTreeService';
import { createLogger } from '../../log';
import type {
  RebaseEditorStateDto,
  RebaseHostMessage,
  RebaseWebviewMessage,
} from '../../shared/rebase/rebaseProtocol';
import { githubRepositoryFor } from '../history/githubLinkHost';
import { GRAPH_LOG_FORMAT } from '../graph/commitGraphService';
import { parseGitLog } from '../../core/gitLogParser';
import type { GraphCommitDto } from '../../shared/graph/graphProtocol';
import { CommitDetailsService } from '../history/commitDetailsService';

const log = createLogger('rebase');

export type RebaseMessagePoster = (message: RebaseHostMessage) => void;

export class InteractiveRebaseController implements vscode.Disposable {
  private readonly service: InteractiveRebaseService;
  private poster: RebaseMessagePoster | undefined;
  private lines: RebaseTodoLine[] = [];
  private onto = 'HEAD';
  private upstream = '';
  private updateRefs = false;
  private stashDirty = false;
  private riskyCount = 0;
  private repoRoot: string | null = null;
  private bootstrapped = false;
  private commits: GraphCommitDto[] = [];
  private reorderId = 0;

  constructor(private readonly gitService: GitExtensionService, private readonly cliRegistry: GitCliRegistry) {
    this.service = new InteractiveRebaseService(
      cliRegistry,
      new WorkingTreeService(gitService, cliRegistry),
    );
  }

  dispose(): void {
    this.dismiss();
  }

  attachPoster(poster: RebaseMessagePoster): void {
    this.poster = poster;
  }

  dismiss(): void {
    this.bootstrapped = false;
    this.post({ type: 'rebaseClose' });
  }

  async open(repoRoot: string, onto?: string): Promise<void> {
    this.repoRoot = repoRoot;
    this.onto = onto ?? 'HEAD';
    this.bootstrapped = false;
    this.upstream = await this.service.defaultUpstream(repoRoot, this.onto);
    const sequencer = await this.service.readSequencer(repoRoot);
    if (sequencer?.active) {
      this.lines = [...sequencer.remaining, ...sequencer.done];
    } else {
      this.lines = await this.service.buildDefaultTodo(repoRoot, this.upstream);
    }
    await this.refreshPreflight();
    await this.loadCommits();
    await this.pushState();
  }

  async handleWebviewMessage(message: RebaseWebviewMessage): Promise<void> {
    if (!this.repoRoot) {
      return;
    }
    try {
      switch (message.type) {
        case 'rebaseReady':
          await this.reloadTodo();
          break;
        case 'rebaseRefresh':
          await this.reloadTodo();
          break;
        case 'rebaseSetOnto':
          this.onto = message.onto.trim();
          this.upstream = await this.service.defaultUpstream(this.repoRoot, this.onto);
          this.lines = await this.service.buildDefaultTodo(this.repoRoot, this.upstream);
          await this.loadCommits();
          await this.refreshPreflight();
          await this.pushState();
          break;
        case 'rebaseSetUpstream':
          this.upstream = message.upstream.trim();
          this.lines = await this.service.buildDefaultTodo(this.repoRoot, this.upstream);
          await this.loadCommits();
          await this.refreshPreflight();
          await this.pushState();
          break;
        case 'rebaseToggleUpdateRefs':
          this.updateRefs = message.enabled;
          await this.pushState();
          break;
        case 'rebaseToggleStash':
          this.stashDirty = message.enabled;
          await this.pushState();
          break;
        case 'rebaseSetCommand':
        case 'rebaseEditMessage':
          if (message.type === 'rebaseEditMessage' || message.command === 'reword') {
            const line = commitLinesOnly(this.lines).find((entry) => entry.hash === message.hash);
            if (line && line.message === undefined) {
              const result = await this.cliRegistry.getOrCreate(this.repoRoot).execRead([
                'log', '-1', '--format=%B', line.hash, '--',
              ]);
              const current = commitLinesOnly(this.lines).find((entry) => entry.hash === message.hash);
              if (current && current.message === undefined) {
                current.message = result.stdout.replace(/\n+$/, '');
              }
            }
          }
          if (message.type === 'rebaseSetCommand') {
            this.lines = this.lines.map((line) =>
              line.kind === 'commit' && line.hash === message.hash
                ? { ...line, command: message.command }
                : line,
            );
          }
          await this.refreshPreflight();
          await this.pushState();
          break;
        case 'rebaseSetMessage':
          this.lines = this.lines.map((line) =>
            line.kind === 'commit' && line.hash === message.hash
              ? { ...line, message: message.message } : line);
          break;
        case 'rebaseRequestCommitDetails': {
          const details = new CommitDetailsService(this.cliRegistry);
          const [body, committer] = await Promise.all([
            details.readBody(this.repoRoot, message.hash),
            details.readCommitter(this.repoRoot, message.hash),
          ]);
          this.post({ type: 'rebaseCommitDetails', hash: message.hash, body, committer });
          break;
        }
        case 'rebaseReorder':
          this.lines = reorderCommitLines(this.lines, message.fromIndex, message.toIndex);
          this.reorderId = message.reorderId ?? this.reorderId;
          await this.refreshPreflight();
          await this.pushState();
          break;
        case 'rebaseSquashLast':
          this.lines = squashLastN(this.lines, message.count, message.mode);
          await this.refreshPreflight();
          await this.pushState();
          break;
        case 'rebaseCombineSelected':
          this.lines = combineSelected(this.lines, new Set(message.hashes), message.mode);
          await this.refreshPreflight();
          await this.pushState();
          break;
        case 'rebaseAutosquashFixups':
          this.lines = applyAutosquashCommands(this.lines);
          await this.refreshPreflight();
          await this.pushState();
          break;
        case 'rebaseStart':
          await this.runStart();
          break;
        case 'rebaseContinue':
          await this.service.continue(this.repoRoot, { stashDirty: this.stashDirty });
          await this.reloadTodo();
          break;
        case 'rebaseSkip':
          await this.service.skip(this.repoRoot, { stashDirty: this.stashDirty });
          await this.reloadTodo();
          break;
        case 'rebaseAbort':
          await this.service.abort(this.repoRoot);
          await this.reloadTodo();
          break;
        case 'rebaseDismiss':
          this.dismiss();
          break;
        default:
          break;
      }
    } catch (error) {
      const text = error instanceof GitCliError ? error.message : String(error);
      log.warn('rebase action failed', error);
      this.post(message.type === 'rebaseRequestCommitDetails'
        ? { type: 'rebaseCommitDetailsError', hash: message.hash, message: text }
        : { type: 'rebaseError', message: text });
    }
  }

  private async runStart(): Promise<void> {
    if (!this.repoRoot) {
      return;
    }
    const preflight = await this.service.preflight(this.repoRoot, this.onto, this.lines);
    if (preflight.riskyRevisions.length > 0) {
      const preview = preflight.riskyRevisions
        .slice(0, 3)
        .map((r) => r.sha.slice(0, 7))
        .join(', ');
      const choice = await vscode.window.showWarningMessage(
        l10n.t(
          '{0} commit(s) may conflict when replayed ({1}). Start rebase anyway?',
          preflight.riskyRevisions.length,
          preview,
        ),
        { modal: true },
        l10n.t('Start rebase'),
      );
      if (choice !== l10n.t('Start rebase')) {
        return;
      }
    }
    try {
      await this.service.start(this.repoRoot, {
        onto: this.onto,
        upstream: this.upstream,
        lines: this.lines,
        updateRefs: this.updateRefs,
        stashDirty: this.stashDirty,
      });
    } catch (error) {
      // Git exits with an error when a commit conflicts, but the rebase is under way: the banner above the
      // graph takes it from here, so only a rebase that never began is an error to show in this window.
      if (!(await this.service.readSequencer(this.repoRoot))?.active) {
        throw error;
      }
      log.info('the rebase stopped partway; the banner shows what is left to do', error);
    }
    this.dismiss();
  }

  private async reloadTodo(): Promise<void> {
    if (!this.repoRoot) {
      return;
    }
    const sequencer = await this.service.readSequencer(this.repoRoot);
    if (sequencer?.active) {
      this.lines = [...sequencer.remaining];
    } else if (!this.upstream) {
      this.upstream = await this.service.defaultUpstream(this.repoRoot, this.onto);
      this.lines = await this.service.buildDefaultTodo(this.repoRoot, this.upstream);
    }
    await this.refreshPreflight();
    await this.loadCommits();
    await this.pushState(sequencer);
  }

  private async loadCommits(): Promise<void> {
    if (!this.repoRoot) { return; }
    const hashes = commitLinesOnly(this.lines).map((line) => line.hash);
    if (hashes.length === 0) {
      this.commits = [];
      return;
    }
    const result = await this.cliRegistry.getOrCreate(this.repoRoot).execRead([
      'log', '--no-walk=unsorted', '--decorate=full', `--format=${GRAPH_LOG_FORMAT}`, ...hashes, '--',
    ]);
    this.commits = parseGitLog(result.stdout);
  }

  private async refreshPreflight(): Promise<void> {
    if (!this.repoRoot) {
      this.riskyCount = 0;
      return;
    }
    const preflight = await this.service.preflight(this.repoRoot, this.onto, this.lines);
    this.riskyCount = preflight.riskyRevisions.length;
  }

  private async pushState(
    sequencer?: Awaited<ReturnType<InteractiveRebaseService['readSequencer']>>,
  ): Promise<void> {
    if (!this.repoRoot) {
      return;
    }
    const seq = sequencer ?? (await this.service.readSequencer(this.repoRoot));
    const state: RebaseEditorStateDto = {
      repoRoot: this.repoRoot,
      onto: this.onto,
      upstream: this.upstream,
      updateRefs: this.updateRefs,
      stashDirty: this.stashDirty,
      lines: commitLinesOnly(this.lines).map((l) => ({
        command: l.command,
        hash: l.hash,
        subject: l.subject,
        message: l.message,
      })),
      sequencer: {
        active: seq?.active ?? false,
        onto: seq?.onto ?? null,
        headName: seq?.headName ?? null,
        msgnum: seq?.msgnum ?? 0,
        end: seq?.end ?? 0,
        summary: seq?.summary ?? '',
      },
      riskyCount: this.riskyCount,
      github: await githubRepositoryFor(this.repoRoot),
      branch: this.gitService.getRepositories().find((repo) => repo.rootUri.fsPath === this.repoRoot)?.state.HEAD?.name ?? null,
      commits: this.commits,
      reorderId: this.reorderId,
    };
    const type = this.bootstrapped ? 'rebaseState' : 'rebaseBootstrap';
    this.bootstrapped = true;
    this.post({ type, state });
  }

  private post(message: RebaseHostMessage): void {
    this.poster?.(message);
  }
}
