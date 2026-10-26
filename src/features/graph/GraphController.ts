import * as vscode from 'vscode';
import { graphIncludesReflog } from './commitGraphService';
import { graphRefresher } from './graphRefresh';
import { createLogger } from '../../log';
import { ALL_COMMITS_FILTER, type GraphCommitDto } from '../../shared/graph/graphProtocol';
import type { HostMessage } from '../../shared/protocol';
import { isStashSelector } from '../../shared/stash/stashProtocol';
import { githubRepositoryFor } from '../history/githubLinkHost';
import type { GitCheckoutPanelManager } from '../../panel/gitCheckoutPanelManager';

const log = createLogger('graph');

/** What GraphController needs from the window that owns it. */
export type GraphContext = Pick<
  GitCheckoutPanelManager,
  | 'activeRepoRoot'
  | 'checkoutService'
  | 'createOrReveal'
  | 'gitService'
  | 'gitSettings'
  | 'graphReady'
  | 'graphService'
  | 'handleGraphError'
  | 'panel'
  | 'postMessage'
  | 'postWhenReady'
  | 'publishBisectSession'
>;

export class GraphController {
  /** Bumped to stop a search that is still scanning history. */
  findGeneration = 0;
  lastGraphMeta: Extract<HostMessage, { type: 'graphMeta' }> | undefined;

  constructor(private readonly ctx: GraphContext) {}

  async collapseMerges(): Promise<void> {
    await this.setCollapseMerges(true);
  }

  async showAllMerges(): Promise<void> {
    await this.setCollapseMerges(false);
  }

  /** Shows only the checked-out branch's history, or all of it again. */
  async toggleActiveBranchOnly(): Promise<void> {
    await this.setActiveBranchOnly(!this.ctx.graphService.isActiveBranchOnly());
  }

  async setActiveBranchOnly(enabled: boolean): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      return;
    }
    await this.ctx.graphService.saveActiveBranchOnly(root, enabled);
    void this.syncGraphActiveBranchOnlyContext();
    log.info(enabled ? 'showing the active branch only' : 'showing every branch');
    await this.sendGraphInitial();
  }

  syncGraphActiveBranchOnlyContext(): Thenable<unknown> {
    return vscode.commands.executeCommand(
      'setContext',
      'gitCheckout.graph.activeBranchOnly',
      this.ctx.graphService.isActiveBranchOnly(),
    );
  }

  async showReflogCommits(): Promise<void> {
    await this.setShowReflog(true);
  }

  async hideReflogCommits(): Promise<void> {
    await this.setShowReflog(false);
  }

  async showRefInGraph(ref: string): Promise<void> {
    this.ctx.createOrReveal();
    await this.setGraphFilter(ref);
  }

  async revealRefInGraph(ref: string): Promise<void> {
    this.ctx.createOrReveal();
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      return;
    }
    try {
      if (isStashSelector(ref) && this.ctx.graphService.shownRef(root) !== ALL_COMMITS_FILTER) {
        await this.setGraphFilter(ALL_COMMITS_FILTER);
      }
      const { sha, reachable } = await this.ctx.graphService.resolveReveal(root, ref);
      this.ctx.postWhenReady({ type: 'graphReveal', ref, sha, reachable });
    } catch (error) {
      log.warn(`could not resolve ${ref} to reveal in graph`, error);
    }
  }

  /** `keepDepth` reloads at least that many commits and tells the view to keep its place. */
  async sendGraphInitial(keepDepth = 0): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      this.ctx.postMessage({ type: 'graphClear' });
      await this.ctx.publishBisectSession();
      return;
    }
    try {
      await this.ctx.graphService.prepareGraphDisplay(root);
      void this.syncGraphCollapseMergesContext();
      void this.syncGraphShowReflogContext();
      void this.syncGraphActiveBranchOnlyContext();
      await this.postGraphMeta(root);
      const page = keepDepth > 0
        ? await this.ctx.graphService.loadInitialThrough(root, keepDepth)
        : await this.ctx.graphService.loadInitial(root);
      this.ctx.postMessage({ type: 'graphPage', page, append: false, ...(keepDepth > 0 ? { keepView: true } : {}) });
      void this.lookUpAvatars(root, page.commits);
    } catch (error) {
      this.ctx.handleGraphError(error);
    }
    await this.ctx.publishBisectSession();
  }

  async sendGraphThrough(index: number): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      return;
    }
    try {
      const page = await this.ctx.graphService.loadThroughIndex(root, index);
      this.ctx.postMessage({ type: 'graphPage', page, append: true });
      void this.lookUpAvatars(root, page.commits);
    } catch (error) {
      this.ctx.handleGraphError(error);
    }
  }

  async sendGraphMore(): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      return;
    }
    try {
      const page = await this.ctx.graphService.loadMore(root);
      this.ctx.postMessage({ type: 'graphPage', page, append: true });
      void this.lookUpAvatars(root, page.commits);
    } catch (error) {
      this.ctx.handleGraphError(error);
    }
  }

  async setGraphFilter(ref: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      return;
    }
    this.ctx.graphService.setFilterRef(root, ref);
    await this.sendGraphInitial();
  }

  private async setCollapseMerges(enabled: boolean): Promise<void> {
    if (this.ctx.graphService.isCollapseMerges() === enabled) {
      return;
    }
    this.ctx.graphService.setCollapseMerges(enabled);
    const root = this.ctx.activeRepoRoot();
    if (root && this.ctx.graphReady()) {
      await this.ctx.graphService.prepareGraphDisplay(root);
    }
    void this.syncGraphCollapseMergesContext();
    log.info(enabled ? 'collapsing merge commits' : 'showing merge commits');
    if (root && this.ctx.graphReady() && this.ctx.panel) {
      // Git lists a different history either way (first-parent only while collapsed), so load it again.
      await this.sendGraphInitial();
    }
  }

  /** Finds the GitHub pictures of authors not known yet and sends them to the graph, when that setting is on. */
  private async lookUpAvatars(repoRoot: string, commits: readonly GraphCommitDto[]): Promise<void> {
    const avatars = this.ctx.graphService.githubAvatars;
    if (!avatars || !this.ctx.gitSettings.graphGitHubAvatars()) {
      return;
    }
    const github = await githubRepositoryFor(repoRoot);
    if (!github) {
      return;
    }
    const found = await avatars.lookUp(github, commits);
    if (Object.keys(found).length > 0) {
      this.ctx.postMessage({ type: 'graphAvatars', avatars: found });
    }
  }

  /** Sends the commits a collapsed merge brought in, so the graph can show it expanded. */
  async expandMerge(sha: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root || !this.ctx.graphReady()) {
      return;
    }
    try {
      const commits = await this.ctx.graphService.loadMergeSide(root, sha);
      this.ctx.postMessage({ type: 'graphMergeSide', sha, commits });
    } catch (error) {
      this.ctx.handleGraphError(error);
    }
  }

  syncGraphCollapseMergesContext(): Thenable<unknown> {
    return vscode.commands.executeCommand(
      'setContext',
      'gitCheckout.graph.collapseMerges',
      this.ctx.graphService.isCollapseMerges(),
    );
  }

  private async setShowReflog(enabled: boolean): Promise<void> {
    // No early return: the cached display can lag the setting until its change event arrives.
    this.ctx.graphService.setShowReflog(enabled);
    void this.syncGraphShowReflogContext();
    log.info(enabled ? 'showing reflog commits' : 'hiding reflog commits');
    await this.sendGraphInitial();
  }

  syncGraphShowReflogContext(): Thenable<unknown> {
    return vscode.commands.executeCommand(
      'setContext',
      'gitCheckout.graph.showReflog',
      this.ctx.graphService.isShowReflog(),
    );
  }

  async findInGraph(query: string): Promise<void> {
    const root = this.ctx.activeRepoRoot();
    if (!root) {
      return;
    }
    log.info('search commits');
    const generation = ++this.findGeneration;
    try {
      await this.ctx.graphService.searchCommits(
        root,
        query,
        (matches, done) =>
          this.ctx.postMessage({
            type: 'graphFindResult',
            query,
            shas: matches.map((match) => match.sha),
            positions: matches.map((match) => match.index),
            done,
          }),
        () => generation !== this.findGeneration,
      );
    } catch (error) {
      this.ctx.handleGraphError(error);
    }
  }

  async checkoutLocalBranchIfNeeded(
    repoRoot: string,
    branch: string,
    token: vscode.CancellationToken,
  ): Promise<void> {
    const head = this.ctx.gitService
      .getDiagnostics()
      .repositories.find((repo) => repo.rootPath === repoRoot)?.headName;
    if (head === branch) {
      return;
    }
    await this.ctx.checkoutService.checkout(repoRoot, branch, {
      cancellationToken: token,
      localBranch: true,
    });
  }

  /** Reloads the graph after the repository changed, keeping the view where it was; see `graphRefresher`. */
  readonly reloadGraphOnHeadChange = graphRefresher(
    () => this.ctx.graphService,
    () => (this.ctx.panel ? this.ctx.activeRepoRoot() : null),
    (keepDepth) => this.sendGraphInitial(keepDepth),
  );

  private async postGraphMeta(repoRoot: string): Promise<void> {
    const github = await githubRepositoryFor(repoRoot);
    const meta = {
      type: 'graphMeta' as const,
      filterRef: this.ctx.graphService.shownRef(repoRoot),
      headRef: this.ctx.graphService.resolveHeadRef(repoRoot),
      activeBranchOnly: this.ctx.graphService.isActiveBranchOnly(),
      collapseMerges: this.ctx.graphService.isCollapseMerges(),
      compactBranchLabels: this.ctx.gitSettings.graphCompactBranchLabels(),
      showReflog: graphIncludesReflog(this.ctx.graphService.shownRef(repoRoot), this.ctx.graphService.isShowReflog()),
      github,
    };
    this.lastGraphMeta = meta;
    this.ctx.postMessage(meta);
  }
}
