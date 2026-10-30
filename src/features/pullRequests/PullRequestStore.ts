import { realpathSync } from 'node:fs';
import * as vscode from 'vscode';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import { loadGitHubRemote } from '../../core/githubRepository';
import { createLogger } from '../../log';
import type { GitHubRepository } from '../../shared/history/githubReferences';
import type { PullRequestDto, PullRequestLists } from '../../shared/pullRequests/pullRequests';
import { fetchPullRequestLists, PullRequestError } from './pullRequestClient';

const log = createLogger('pull-requests');

/** What the sidebar shows for a repository's pull requests. */
export type PullRequestState =
  /** Turned off in the settings, or the repository is not on GitHub: nothing is shown. */
  | { kind: 'hidden' }
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'needsAccess' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; repo: GitHubRepository; remote: string; lists: PullRequestLists };

/** Public repositories need no more than the sign-in the pictures use; private ones need `repo`. */
const BASIC_SCOPES = ['read:user'];
const PRIVATE_SCOPES = ['repo'];
const AUTH_PROVIDER = 'github';

/** The same repository can be reached by more than one path, such as through a symlink; they share one entry. */
function keyOf(repoRoot: string): string {
  try {
    return realpathSync(repoRoot);
  } catch {
    // A folder that is gone has only the path it was given.
    return repoRoot;
  }
}

/** The pull requests of each repository, read from GitHub with VS Code's own GitHub sign-in and kept until refreshed. */
export class PullRequestStore implements vscode.Disposable {
  private readonly states = new Map<string, PullRequestState>();
  private readonly loading = new Set<string>();
  /** Repositories whose state a test set; a reading that was already under way must not replace it. */
  private readonly seeded = new Set<string>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly disposables: vscode.Disposable[] = [this.changed];

  constructor(private readonly cliRegistry: GitCliRegistry) {
    this.disposables.push(
      vscode.authentication.onDidChangeSessions((event) => {
        if (event.provider.id === AUTH_PROVIDER) {
          this.refresh();
        }
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('gitCheckout.pullRequests')) {
          this.refresh();
        }
      }),
    );
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  static enabled(): boolean {
    return vscode.workspace.getConfiguration('gitCheckout.pullRequests').get<boolean>('enabled', true);
  }

  /** What to show now. The first ask for a repository starts reading, and the change event comes when there is something to show. */
  peek(repoRoot: string): PullRequestState {
    if (!PullRequestStore.enabled()) {
      return { kind: 'hidden' };
    }
    const known = this.states.get(keyOf(repoRoot));
    if (known) {
      return known;
    }
    // Whether the repository is on GitHub is not known yet; nothing shows until it is, so other repositories never flash a section.
    void this.load(repoRoot);
    return { kind: 'hidden' };
  }

  /** Sets what a repository shows, as if GitHub had answered (e2e only: the tests have no GitHub to ask). */
  seed(repoRoot: string, state: PullRequestState): void {
    this.seeded.add(keyOf(repoRoot));
    this.set(repoRoot, state);
  }

  /** Reads every repository again. */
  refresh(): void {
    this.states.clear();
    this.seeded.clear();
    this.changed.fire();
  }

  /** The pull request with this number in the repository's last reading, if the list has it. */
  find(repoRoot: string, number: number): { pull: PullRequestDto; repo: GitHubRepository; remote: string } | undefined {
    const state = this.states.get(keyOf(repoRoot));
    if (state?.kind !== 'ready') {
      return undefined;
    }
    const pull = [...state.lists.allOpen, ...state.lists.createdByMe, ...state.lists.reviewRequested].find((entry) => entry.number === number);
    return pull && { pull, repo: state.repo, remote: state.remote };
  }

  /** Asks for GitHub's sign-in, in VS Code's own prompt, and reads again once it is done. */
  async signIn(privateRepositories = false): Promise<void> {
    await vscode.authentication.getSession(AUTH_PROVIDER, privateRepositories ? PRIVATE_SCOPES : BASIC_SCOPES, { createIfNone: true });
    this.refresh();
  }

  private async session(): Promise<vscode.AuthenticationSession | undefined> {
    // The wider sign-in covers the narrower use, so it is used when there is one.
    return (
      (await vscode.authentication.getSession(AUTH_PROVIDER, PRIVATE_SCOPES, { silent: true })) ??
      (await vscode.authentication.getSession(AUTH_PROVIDER, BASIC_SCOPES, { silent: true }))
    );
  }

  private set(repoRoot: string, state: PullRequestState): void {
    this.states.set(keyOf(repoRoot), state);
    this.changed.fire();
  }

  /** A reading's result, unless the state was set by a test meanwhile. */
  private finish(repoRoot: string, state: PullRequestState): void {
    if (!this.seeded.has(keyOf(repoRoot))) {
      this.set(repoRoot, state);
    }
  }

  private async load(repoRoot: string): Promise<void> {
    const key = keyOf(repoRoot);
    if (this.loading.has(key)) {
      return;
    }
    this.loading.add(key);
    try {
      const github = await loadGitHubRemote(this.cliRegistry.getOrCreate(repoRoot));
      if (!github) {
        this.finish(repoRoot, { kind: 'hidden' });
        return;
      }
      this.finish(repoRoot, { kind: 'loading' });
      const session = await this.session();
      if (!session) {
        this.finish(repoRoot, { kind: 'signedOut' });
        return;
      }
      try {
        const lists = await fetchPullRequestLists(github.repo, session.accessToken);
        this.finish(repoRoot, { kind: 'ready', repo: github.repo, remote: github.remote, lists });
      } catch (error) {
        const failure = error instanceof PullRequestError ? error.failure : 'other';
        log.warn('could not read the pull requests', error);
        this.finish(
          repoRoot,
          failure === 'unauthorized' ? { kind: 'signedOut' } : failure === 'needsAccess' ? { kind: 'needsAccess' } : { kind: 'error', message: error instanceof Error ? error.message : String(error) },
        );
      }
    } catch (error) {
      log.warn('could not find the GitHub remote', error);
      this.finish(repoRoot, { kind: 'hidden' });
    } finally {
      this.loading.delete(key);
    }
  }
}
