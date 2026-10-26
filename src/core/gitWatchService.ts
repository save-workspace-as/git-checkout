import * as vscode from 'vscode';
import type { GitCliRegistry } from './gitCliRegistry';
import type { GitExtensionService } from './gitExtensionService';
import type { RepositoryRefreshEvent } from './gitRefresh';
import { GitRepositoryWatcher } from './gitRepositoryWatcher';
import { formatWatchVerifyReport } from './gitWatchReport';
import { createWorkspaceGitCheckoutSettings } from './gitCheckoutSettings';
import type { Repository } from './vscodeGitApi';
import { createLogger } from '../log';

const log = createLogger('watch');

export class GitWatchService implements vscode.Disposable {
  private readonly _onDidRefresh = new vscode.EventEmitter<RepositoryRefreshEvent>();
  readonly onDidRefresh = this._onDidRefresh.event;

  private readonly sessions = new Map<string, GitRepositoryWatcher>();
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly gitService: GitExtensionService,
    private readonly cliRegistry: GitCliRegistry,
    private readonly debounceMs: number,
  ) {
    this.disposables.push(this._onDidRefresh);
  }

  syncRepositories(): void {
    if (this.gitService.getDiagnostics().bindingState !== 'ready') {
      this.disposeAllSessions();
      return;
    }

    const repos = this.gitService.getRepositories();
    const open = new Set(repos.map((r) => r.rootUri.fsPath));

    for (const root of this.sessions.keys()) {
      if (!open.has(root)) {
        this.sessions.get(root)?.dispose();
        this.sessions.delete(root);
      }
    }

    for (const repo of repos) {
      const root = repo.rootUri.fsPath;
      if (this.sessions.has(root)) {
        continue;
      }
      void this.startSession(repo);
    }
  }

  async reresolveAll(): Promise<void> {
    const sessions = [...this.sessions.values()];
    await Promise.all(sessions.map((s) => s.reresolveLayout()));
  }

  formatVerifyReport(): string {
    const snapshots = [...this.sessions.values()].map((s) => s.getSnapshot());
    return formatWatchVerifyReport(snapshots);
  }

  dispose(): void {
    this.disposeAllSessions();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }

  private disposeAllSessions(): void {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
  }

  private async startSession(repo: Repository): Promise<void> {
    const root = repo.rootUri.fsPath;
    if (this.sessions.has(root)) {
      return;
    }

    try {
      const cli = this.cliRegistry.forRepository(repo);
      const rootPath = repo.rootUri.fsPath;
      const watcher = new GitRepositoryWatcher(repo, cli, this.debounceMs, (reason, headShort, at) => {
        const event = { repoRoot: rootPath, reason, headShort, at };
        log.debug(formatRefreshLogLine(event));
        this._onDidRefresh.fire(event);
      });
      this.sessions.set(root, watcher);
      await watcher.start();
    } catch (error) {
      log.warn(`skipped for ${root}`, error);
      this.sessions.delete(root);
    }
  }
}

function formatRefreshLogLine(event: RepositoryRefreshEvent): string {
  return `refresh ${event.repoRoot} (${event.reason}) HEAD=${event.headShort ?? '?'}`;
}

export function getWatchDebounceMs(): number {
  return createWorkspaceGitCheckoutSettings().watchDebounceMs();
}
