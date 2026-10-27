import * as vscode from 'vscode';
import type { API, GitExtension, Repository } from './vscodeGitApi';
import {
  extensionKindLabel,
  type GitBindingState,
  type RepositoryDiagnostic,
  type WorkspaceDiagnostics,
} from './diagnostics';
import { resolveWorkspaceGitPath, type WorkspaceGitPath } from './gitPath';
import { createLogger } from '../log';

const log = createLogger('git-extension');

const GIT_EXTENSION_ID = 'vscode.git';
const OUR_EXTENSION_ID = 'save-workspace-as.git-checkout';

export class GitExtensionService implements vscode.Disposable {
  private readonly _onDidChangeDiagnostics = new vscode.EventEmitter<void>();
  readonly onDidChangeDiagnostics = this._onDidChangeDiagnostics.event;

  private api: API | undefined;
  private gitExtension: GitExtension | undefined;
  private bindingState: GitBindingState = 'api_unavailable';
  private readonly repoDisposables = new Map<Repository, vscode.Disposable>();
  private apiSubscriptions: vscode.Disposable[] = [];
  private loggedRejectedGitPath = false;

  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(this._onDidChangeDiagnostics);
  }

  async initialize(): Promise<void> {
    const extension = vscode.extensions.getExtension<GitExtension>(GIT_EXTENSION_ID);
    if (!extension) {
      this.bindingState = 'git_extension_missing';
      this.fireDiagnosticsChanged();
      return;
    }

    const git = extension.isActive ? extension.exports : await extension.activate();
    this.gitExtension = git;
    this.disposables.push(
      git.onDidChangeEnablement(() => {
        void this.syncFromGitExtension(extension);
      }),
    );

    await this.syncFromGitExtension(extension);
  }

  getGitPath(): string | null {
    return this.workspaceGitPath().path;
  }

  getRepositories(): readonly Repository[] {
    return this.api?.repositories ?? [];
  }

  getDiagnostics(): WorkspaceDiagnostics {
    const ourExt = vscode.extensions.getExtension(OUR_EXTENSION_ID);
    const gitPath = this.workspaceGitPath();

    return {
      bindingState: this.bindingState,
      remoteName: vscode.env.remoteName ?? null,
      extensionKind: extensionKindLabel(ourExt?.extensionKind),
      gitExtensionEnabled: this.gitExtension?.enabled ?? false,
      gitPath: gitPath.path,
      gitPathWarning: gitPath.warning,
      repositories: this.getRepositories().map((r) => this.toRepoDiagnostic(r)),
    };
  }

  dispose(): void {
    this.clearRepositoryListeners();
    this.clearApiSubscriptions();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.disposables.length = 0;
  }

  private async syncFromGitExtension(
    extension: vscode.Extension<GitExtension>,
  ): Promise<void> {
    const git = extension.exports;

    if (!git.enabled) {
      this.api = undefined;
      this.bindingState = 'git_disabled';
      this.clearRepositoryListeners();
      this.clearApiSubscriptions();
      this.fireDiagnosticsChanged();
      return;
    }

    try {
      this.api = git.getAPI(1);
      this.bindingState = 'ready';
      this.wireRepositories(this.api);
      this.fireDiagnosticsChanged();
    } catch (error) {
      log.warn('vscode.git getAPI(1) failed', error);
      this.api = undefined;
      this.bindingState = 'api_unavailable';
      this.clearRepositoryListeners();
      this.clearApiSubscriptions();
      this.fireDiagnosticsChanged();
    }
  }

  private wireRepositories(api: API): void {
    this.clearRepositoryListeners();
    this.clearApiSubscriptions();

    for (const repo of api.repositories) {
      this.trackRepository(repo);
    }

    this.apiSubscriptions = [
      api.onDidOpenRepository((repo) => {
        this.trackRepository(repo);
        this.fireDiagnosticsChanged();
      }),
      api.onDidCloseRepository((repo) => {
        this.untrackRepository(repo);
        this.fireDiagnosticsChanged();
      }),
    ];
  }

  private clearApiSubscriptions(): void {
    for (const d of this.apiSubscriptions) {
      d.dispose();
    }
    this.apiSubscriptions = [];
  }

  private trackRepository(repo: Repository): void {
    if (this.repoDisposables.has(repo)) {
      return;
    }
    this.repoDisposables.set(
      repo,
      repo.state.onDidChange(() => this.fireDiagnosticsChanged()),
    );
  }

  private untrackRepository(repo: Repository): void {
    const d = this.repoDisposables.get(repo);
    d?.dispose();
    this.repoDisposables.delete(repo);
  }

  private clearRepositoryListeners(): void {
    for (const d of this.repoDisposables.values()) {
      d.dispose();
    }
    this.repoDisposables.clear();
  }

  private workspaceGitPath(): WorkspaceGitPath {
    const resolved = resolveWorkspaceGitPath(this.api?.git.path);
    if (resolved.warning && !this.loggedRejectedGitPath) {
      this.loggedRejectedGitPath = true;
      log.warn(resolved.warning);
    }
    return resolved;
  }

  private toRepoDiagnostic(repo: Repository): RepositoryDiagnostic {
    return {
      rootPath: repo.rootUri.fsPath,
      headName: repo.state.HEAD?.name ?? null,
    };
  }

  private fireDiagnosticsChanged(): void {
    this._onDidChangeDiagnostics.fire();
  }
}

export { getGitExtensionService, setGitExtensionService } from './gitExtensionServiceState';
