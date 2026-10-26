import type { Disposable } from 'vscode';
import type { Repository } from './vscodeGitApi';
import { GitCliError } from './gitCliError';
import { GitCli } from './gitCli';
import { GitOperationQueue } from './gitOperationQueue';
import { getGitExtensionService } from './gitExtensionServiceState';

export class GitCliRegistry implements Disposable {
  private readonly clients = new Map<string, GitCli>();
  private readonly queues = new Map<string, GitOperationQueue>();

  getOrCreate(repoRoot: string): GitCli {
    const service = getGitExtensionService();
    const diagnostics = service?.getDiagnostics();
    if (!service || !diagnostics || diagnostics.bindingState !== 'ready') {
      throw new GitCliError(
        'NotReady',
        'vscode.git is not ready. Enable the built-in Git extension and open a repository.',
        repoRoot,
      );
    }

    const gitPath = diagnostics.gitPath;
    if (!gitPath) {
      throw new GitCliError(
        'NotReady',
        diagnostics.gitPathWarning ?? 'git.path is unavailable from vscode.git.',
        repoRoot,
      );
    }

    let cli = this.clients.get(repoRoot);
    if (!cli) {
      let queue = this.queues.get(repoRoot);
      if (!queue) {
        queue = new GitOperationQueue();
        this.queues.set(repoRoot, queue);
      }
      cli = new GitCli(gitPath, repoRoot, queue);
      this.clients.set(repoRoot, cli);
    }
    return cli;
  }

  forRepository(repo: Repository): GitCli {
    return this.getOrCreate(repo.rootUri.fsPath);
  }

  runWrite<T>(repoRoot: string, fn: () => Promise<T>): Promise<T> {
    return this.getOrCreate(repoRoot).runWriteTask(fn);
  }

  syncOpenRepositories(openRoots: readonly string[]): void {
    const open = new Set(openRoots);
    for (const root of this.clients.keys()) {
      if (!open.has(root)) {
        this.clients.delete(root);
        this.queues.delete(root);
      }
    }
  }

  dispose(): void {
    this.clients.clear();
    this.queues.clear();
  }
}

let registry: GitCliRegistry | undefined;

export function getGitCliRegistry(): GitCliRegistry {
  if (!registry) {
    registry = new GitCliRegistry();
  }
  return registry;
}
