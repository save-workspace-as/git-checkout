import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Debouncer } from './debounce';
import type { GitCli } from './gitCli';
import { coalescePendingRefreshReason, type RefreshReason } from './gitRefresh';
import {
  type GitRepositoryLayout,
  resolveRepositoryLayout,
} from './gitRepositoryLayout';
import type { Repository } from './vscodeGitApi';
import { createLogger } from '../log';

const log = createLogger('watch');

const LAYOUT_RERESOLVE_MS = 2_000;

export interface RepositoryWatchSnapshot {
  repoRoot: string;
  layout: GitRepositoryLayout | null;
  watchersActive: boolean;
  lastRefreshAt: number | null;
  lastRefreshReason: RefreshReason | null;
  lastHeadShort: string | null;
}

function pattern(baseDir: string, glob: string): vscode.RelativePattern {
  return new vscode.RelativePattern(vscode.Uri.file(baseDir), glob);
}

function watchPath(
  baseDir: string,
  glob: string,
  onEvent: () => void,
): vscode.FileSystemWatcher {
  const watcher = vscode.workspace.createFileSystemWatcher(pattern(baseDir, glob));
  watcher.onDidChange(onEvent);
  watcher.onDidCreate(onEvent);
  watcher.onDidDelete(onEvent);
  return watcher;
}

export class GitRepositoryWatcher implements vscode.Disposable {
  private layout: GitRepositoryLayout | null = null;
  private readonly disposables: vscode.Disposable[] = [];
  private readonly debouncer: Debouncer;
  private readonly layoutDebouncer: Debouncer;
  private pendingReason: RefreshReason = 'vscodeGitState';
  private lastRefreshAt: number | null = null;
  private lastRefreshReason: RefreshReason | null = null;
  private lastHeadShort: string | null = null;
  private disposed = false;

  constructor(
    private readonly repo: Repository,
    private readonly cli: GitCli,
    debounceMs: number,
    private readonly onRefresh: (reason: RefreshReason, headShort: string | null, at: number) => void,
  ) {
    this.debouncer = new Debouncer(debounceMs);
    this.layoutDebouncer = new Debouncer(LAYOUT_RERESOLVE_MS);
  }

  async start(): Promise<void> {
    await this.applyLayout(true);
  }

  async reresolveLayout(): Promise<void> {
    await this.applyLayout(false);
  }

  getSnapshot(): RepositoryWatchSnapshot {
    return {
      repoRoot: this.repo.rootUri.fsPath,
      layout: this.layout,
      watchersActive: this.disposables.length > 0,
      lastRefreshAt: this.lastRefreshAt,
      lastRefreshReason: this.lastRefreshReason,
      lastHeadShort: this.lastHeadShort,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.clearWatchers();
    this.debouncer.dispose();
    this.layoutDebouncer.dispose();
  }

  private async applyLayout(isInitial: boolean): Promise<void> {
    if (this.disposed) {
      return;
    }

    try {
      const layout = await resolveRepositoryLayout(this.cli, this.repo.rootUri.fsPath);
      const layoutChanged =
        !this.layout ||
        this.layout.gitDir !== layout.gitDir ||
        this.layout.commonDir !== layout.commonDir;

      this.layout = layout;

      if (layoutChanged) {
        this.clearWatchers();
        this.attachWatchers(layout);
      }

      if (isInitial) {
        await this.runRefresh('layout');
      }
    } catch (error) {
      log.warn(`could not resolve git layout for ${this.repo.rootUri.fsPath}; watchers disabled`, error);
      this.layout = null;
      this.clearWatchers();
    }
  }

  private clearWatchers(): void {
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }

  private attachWatchers(layout: GitRepositoryLayout): void {
    const scheduleFs = (): void => this.scheduleRefresh('filesystem');
    const scheduleLayout = (): void => {
      this.layoutDebouncer.schedule(() => {
        void this.applyLayout(false);
      });
    };

    this.disposables.push(
      watchPath(path.dirname(layout.headPath), path.basename(layout.headPath), scheduleFs),
    );
    this.disposables.push(
      watchPath(path.dirname(layout.indexPath), path.basename(layout.indexPath), scheduleFs),
    );

    if (fs.existsSync(layout.refsDir)) {
      this.disposables.push(watchPath(layout.refsDir, '**', scheduleFs));
    }

    const packedParent = path.dirname(layout.packedRefsPath);
    this.disposables.push(
      watchPath(packedParent, path.basename(layout.packedRefsPath), scheduleFs),
    );

    if (layout.reftableDir) {
      this.disposables.push(watchPath(layout.reftableDir, '**', scheduleFs));
    }

    if (fs.existsSync(layout.worktreesDir)) {
      this.disposables.push(watchPath(layout.worktreesDir, '**', scheduleLayout));
    }

    if (fs.existsSync(layout.modulesDir)) {
      this.disposables.push(watchPath(layout.modulesDir, '**', scheduleFs));
    }

    if (fs.existsSync(layout.configPath)) {
      this.disposables.push(
        watchPath(path.dirname(layout.configPath), path.basename(layout.configPath), scheduleLayout),
      );
    }

    this.disposables.push(
      this.repo.state.onDidChange(() => this.scheduleRefresh('vscodeGitState')),
    );
  }

  private scheduleRefresh(reason: RefreshReason): void {
    this.pendingReason = coalescePendingRefreshReason(this.pendingReason, reason);
    this.debouncer.schedule(() => {
      const reason = this.pendingReason;
      this.pendingReason = 'vscodeGitState';
      void this.runRefresh(reason);
    });
  }

  private async runRefresh(reason: RefreshReason): Promise<void> {
    if (this.disposed) {
      return;
    }

    // Future status/graph loaders use porcelain git (e.g. status --porcelain=2), not WD walks.
    const headShort = await this.cli.revParseShortHead();
    const at = Date.now();
    this.lastRefreshAt = at;
    this.lastRefreshReason = reason;
    this.lastHeadShort = headShort;
    this.onRefresh(reason, headShort, at);
  }
}
