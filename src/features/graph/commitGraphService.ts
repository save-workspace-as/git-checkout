import { createHash } from 'node:crypto';
import { graphSearchGitArgs, parseGraphSearchQuery } from '../../shared/graph/searchQuery';
import type * as vscode from 'vscode';
import { createLogger } from '../../log';
import {
    ALL_COMMITS_FILTER,
    type GraphCommitDto,
    type GraphOrder,
    type GraphPageDto,
} from '../../shared/graph/graphProtocol';
import type { StashEntryDto } from '../../shared/stash/stashProtocol';
import { sameWorktreePath } from '../worktrees/worktreeParser';
import { graphLogRevision } from '../../shared/graph/activeBranchGraph';
import {
    getCollapseMerges,
    getFilterRef,
    setCollapseMerges,
    setFilterRef,
} from './graphFilterPreferences';
import {
    defaultGitCheckoutSettings,
    type GitCheckoutSettingsReader,
} from '../../core/gitCheckoutSettings';
import type { GitCli } from '../../core/gitCli';
import { GitCliError } from '../../core/gitCliError';
import type { GitCliRegistry } from '../../core/gitCliRegistry';
import type { GitExtensionService } from '../../core/gitExtensionService';
import { parseGitLog } from '../../core/gitLogParser';
import {
  applyRepoGraphOverrides,
  parseGitConfigPairs,
  REPO_GRAPH_CONFIG_REGEXP,
  type GraphDisplay,
} from '../../core/repoSettings';
import { gravatarUrl } from '../../core/gravatar';
import type { GitHubAvatars } from './githubAvatars';
import { labelStashCommits, parseStashList, STASH_LIST_ARGS } from '../stash/stashParser';
import { RepositoryNotOpenError } from '../../core/repositoryNotOpenError';

const log = createLogger('graph');

export const GRAPH_PAGE_SIZE = 80;

export const GRAPH_LOG_FORMAT = '%H%x00%P%x00%s%x00%an%x00%ae%x00%at%x00%D%x00';

export function buildGraphLogArgs(
  filterRef: string,
  skip: number,
  order: GraphOrder = 'date',
  extraRevs: readonly string[] = [],
  includeReflog = false,
  limit = GRAPH_PAGE_SIZE,
  hide: HiddenGraphRefs = {},
  /** Collapsed merges: Git lists first-parent history only, so a page fills with commits that are shown. */
  firstParent = false,
): string[] {
  const args = [
    'log',
    '-n',
    String(limit),
    order === 'topo' ? '--topo-order' : '--date-order',
    ...(firstParent ? ['--first-parent'] : []),
    '--decorate=full',
    '--date=unix',
    `--pretty=format:${GRAPH_LOG_FORMAT}`,
  ];
  // Hidden refs leave the graph twice: the walk no longer starts from them (only `--all` walks every ref), and
  // their labels are not drawn on commits that other refs still reach.
  const hidden = hiddenRefPatterns(hide);
  for (const pattern of hidden) {
    args.push(`--decorate-refs-exclude=${pattern}`);
  }
  if (includeReflog) {
    args.push('--reflog');
  }
  if (filterRef === ALL_COMMITS_FILTER) {
    for (const pattern of hidden) {
      args.push(`--exclude=${pattern}`);
    }
  }
  args.push(filterRef, ...extraRevs);
  if (skip > 0) {
    args.push(`--skip=${skip}`);
  }
  return args;
}

/** Kinds of refs the graph leaves out. */
export interface HiddenGraphRefs {
  stashes?: boolean;
  remoteBranches?: boolean;
  tags?: boolean;
}

function hiddenRefPatterns(hide: HiddenGraphRefs): string[] {
  return [
    ...(hide.stashes ? ['refs/stash'] : []),
    ...(hide.remoteBranches ? ['refs/remotes/*'] : []),
    ...(hide.tags ? ['refs/tags/*'] : []),
  ];
}

/** Reflog tips are extra starting points, so they stay on the all-commits walk. */
export function graphIncludesReflog(revision: string, showReflog: boolean): boolean {
  return showReflog && revision === ALL_COMMITS_FILTER;
}

/** Commits scanned per git call while searching, so results can stream and a search can stop early. */
/** Most commits one jump to a distant search match loads at once. */
const MAX_JUMP_LOAD = 50_000;

export const SEARCH_CHUNK_SIZE = 2000;
/** How many commits of a merged-in branch an expanded merge shows. */
const MERGE_SIDE_LIMIT = 500;
const SEARCH_READ_TIMEOUT_MS = 120_000;
const HASH_PREFIX = /^[0-9a-f]{4,64}$/i;
const HASH_FULL = /^[0-9a-f]{40,64}$/i;

export function defaultStartRef(filterRef: string, headRef: string | null): string {
  return filterRef === ALL_COMMITS_FILTER ? (headRef ?? 'HEAD') : filterRef;
}

interface RepoGraphState {
  filterRef: string;
  skip: number;
}

export class CommitGraphService {
  private readonly stateByRepo = new Map<string, RepoGraphState>();
  private readonly graphDisplayByRepo = new Map<string, GraphDisplay>();
  private activeBranchOnlyOverride: boolean | undefined;
  /** Toggled value until the `gitCheckout.graph.showReflog` write lands in settings. */
  private showReflogOverride: boolean | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly gitService: GitExtensionService,
    private readonly cliRegistry: GitCliRegistry,
    private readonly settings: GitCheckoutSettingsReader = defaultGitCheckoutSettings,
  ) {}

  /** The branch checked out in `repoRoot`; the only repository's when none is named. */
  resolveHeadRef(repoRoot?: string): string | null {
    const repos = this.gitService.getDiagnostics().repositories;
    if (repoRoot === undefined) {
      return repos[0]?.headName ?? null;
    }
    const repo = repos.find((candidate) => sameWorktreePath(candidate.rootPath, repoRoot));
    return repo?.headName ?? null;
  }

  /**
   * The branch checked out in `repoRoot`. When `vscode.git` has not read the repository's HEAD yet (right after
   * the repository opens, or on a slow machine), Git itself is asked, so a form never starts from `HEAD`
   * while a branch is checked out. Null when HEAD is detached.
   */
  async currentBranch(repoRoot: string): Promise<string | null> {
    const known = this.resolveHeadRef(repoRoot);
    if (known) {
      return known;
    }
    try {
      const out = await this.cliRegistry.getOrCreate(repoRoot).execRead(['branch', '--show-current']);
      return out.stdout.trim() || null;
    } catch (error) {
      log.debug('could not read the current branch; treating HEAD as detached', error);
      return null;
    }
  }

  getFilterRef(repoRoot: string): string {
    return getFilterRef(this.context, repoRoot) ?? ALL_COMMITS_FILTER;
  }

  /** Revision the graph is showing: the saved filter, or the checked-out branch. */
  shownRef(repoRoot: string): string {
    return graphLogRevision(
      this.getFilterRef(repoRoot),
      this.resolveHeadRef(repoRoot),
      this.isActiveBranchOnly(),
    );
  }

  isActiveBranchOnly(): boolean {
    return this.displayForActiveRepo()?.activeBranchOnly ?? this.activeBranchOnlyOverride ?? false;
  }

  setActiveBranchOnly(enabled: boolean): void {
    this.activeBranchOnlyOverride = enabled;
    this.graphDisplayByRepo.clear();
    this.stateByRepo.clear();
  }

  /** Saves the choice in the repository's own Git config, where `readGraphDisplay` reads it back. */
  async saveActiveBranchOnly(repoRoot: string, enabled: boolean): Promise<void> {
    await this.cliRegistry
      .getOrCreate(repoRoot)
      .execWrite(['config', '--local', 'gitcheckout.graph.activeBranchOnly', String(enabled)]);
    this.setActiveBranchOnly(enabled);
  }

  isCollapseMerges(): boolean {
    return this.displayForActiveRepo()?.collapseMerges ?? getCollapseMerges(this.context);
  }

  setCollapseMerges(enabled: boolean): void {
    setCollapseMerges(this.context, enabled);
    this.graphDisplayByRepo.clear();
  }

  isShowReflog(): boolean {
    return this.displayForActiveRepo()?.showReflog ?? this.showReflogBase();
  }

  setShowReflog(enabled: boolean): void {
    this.showReflogOverride = enabled;
    this.graphDisplayByRepo.clear();
    this.stateByRepo.clear();
    this.settings.setGraphShowReflog(enabled).catch((error: unknown) => {
      log.warn('could not save the show reflog setting', error);
    });
  }

  /** Drops cached display state after `gitCheckout.graph.showReflog` changes. */
  onShowReflogSettingChanged(): void {
    this.showReflogOverride = undefined;
    this.graphDisplayByRepo.clear();
    this.stateByRepo.clear();
  }

  /** Drops cached display state after a `gitCheckout.graph.show*` setting changes. */
  onGraphVisibilitySettingChanged(): void {
    this.graphDisplayByRepo.clear();
    this.stateByRepo.clear();
  }

  private showReflogBase(): boolean {
    return this.showReflogOverride ?? this.settings.graphShowReflog();
  }

  /** Re-read local `gitcheckout.graph.*` before posting graph state. */
  async prepareGraphDisplay(repoRoot: string): Promise<void> {
    const cli = this.cliForRoot(repoRoot);
    this.graphDisplayByRepo.delete(repoRoot);
    await this.graphDisplayFor(repoRoot, cli);
  }

  setFilterRef(repoRoot: string, filterRef: string): void {
    setFilterRef(this.context, repoRoot, filterRef.trim() || 'HEAD');
    this.stateByRepo.delete(repoRoot);
  }

  /** Commits in the current filter matching the query by message, author, or hash prefix; newest first. */
  /**
   * Searches history in graph order, a chunk of commits at a time, reporting matches as they are found
   * so the caller can show the first one right away. Stops early when `isCancelled` turns true.
   */
  async searchCommits(
    repoRoot: string,
    query: string,
    onBatch: (matches: SearchMatch[], done: boolean) => void,
    isCancelled: () => boolean = () => false,
  ): Promise<void> {
    const parsed = parseGraphSearchQuery(query);
    const trimmed = parsed.text.trim();
    const filters = graphSearchGitArgs(parsed);
    if (!trimmed && !filters) {
      onBatch([], true);
      return;
    }
    const cli = this.cliForRoot(repoRoot);
    const { order, collapseMerges } = await this.graphDisplayFor(repoRoot, cli);
    const revision = this.logRevisionArgs(this.shownRef(repoRoot));
    // The filters are applied by Git to a list of hashes; the scan below still walks the whole graph,
    // so a match keeps the row it has in the graph.
    const allowed = filters
      ? new Set(
        (await cli.execRead(
          ['log', '--format=%H', ...filters.args, ...revision, ...(filters.path ? ['--', filters.path] : [])],
          { timeoutMs: SEARCH_READ_TIMEOUT_MS },
        )).stdout.split(/\r?\n/).filter(Boolean),
      )
      : undefined;
    let offset = 0;
    let total = 0;
    for (;;) {
      const result = await cli.execRead(
        [
          'log',
          '-n',
          String(SEARCH_CHUNK_SIZE),
          `--skip=${offset}`,
          order === 'topo' ? '--topo-order' : '--date-order',
          // The rows the graph shows: with collapsed merges, first-parent history only.
          ...(collapseMerges ? ['--first-parent'] : []),
          '--pretty=format:%H%x00%an%x00%ae%x00%B%x01',
          ...revision,
        ],
        { timeoutMs: SEARCH_READ_TIMEOUT_MS },
      );
      const records = parseSearchRecords(result.stdout);
      const shas = records.flatMap((record, i) =>
        (allowed ? allowed.has(record.sha) : true) && (trimmed ? commitMatchesQuery(record, trimmed) : true)
          ? [{ sha: record.sha, index: offset + i }]
          : [],
      );
      total += shas.length;
      const done = records.length < SEARCH_CHUNK_SIZE;
      if (isCancelled()) {
        return;
      }
      onBatch(shas, done);
      if (done) {
        log.debug(`search matched ${total} commits`);
        return;
      }
      if (isCancelled()) {
        return;
      }
      offset += records.length;
    }
  }

  /**
   * The commits a merge brought in: reachable from its other parents but not from its first parent,
   * in graph order, for showing a collapsed merge expanded.
   */
  async loadMergeSide(repoRoot: string, mergeSha: string, limit = MERGE_SIDE_LIMIT): Promise<GraphCommitDto[]> {
    const cli = this.cliForRoot(repoRoot);
    const display = await this.graphDisplayFor(repoRoot, cli);
    const result = await cli.execRead([
      'log',
      '-n',
      String(limit),
      display.order === 'topo' ? '--topo-order' : '--date-order',
      '--decorate=full',
      '--date=unix',
      `--pretty=format:${GRAPH_LOG_FORMAT}`,
      `${mergeSha}^@`,
      `^${mergeSha}^1`,
    ]);
    return this.withAvatars(parseGitLog(result.stdout), display.gravatar);
  }

  /** Every match for `query`, in graph order. */
  async findCommits(repoRoot: string, query: string): Promise<string[]> {
    const found: string[] = [];
    await this.searchCommits(repoRoot, query, (matches) => found.push(...matches.map((match) => match.sha)));
    return found;
  }

  reset(repoRoot: string): void {
    this.stateByRepo.delete(repoRoot);
    this.graphDisplayByRepo.delete(repoRoot);
  }

  /** Resolves a ref to its commit and whether that commit is in the current filter's history. */
  async resolveReveal(repoRoot: string, ref: string): Promise<{ sha: string; reachable: boolean }> {
    const cli = this.cliForRoot(repoRoot);
    const sha = (await cli.execRead(['rev-parse', '--verify', `${ref}^{commit}`])).stdout.trim();
    const filterRef = this.shownRef(repoRoot);
    if (filterRef === ALL_COMMITS_FILTER) {
      return { sha, reachable: true };
    }
    try {
      await cli.execRead(['merge-base', '--is-ancestor', sha, filterRef]);
      return { sha, reachable: true };
    } catch (error) {
      // exit 1: the commit is not in the filtered ref's history
      log.debug(`commit ${sha} is outside the filtered ref history`, error);
      return { sha, reachable: false };
    }
  }

  async loadInitial(repoRoot: string): Promise<GraphPageDto> {
    this.stateByRepo.set(repoRoot, this.freshState(repoRoot));
    return this.fetchPage(repoRoot, false);
  }

  /**
   * Changes whenever what the graph draws from refs changes: any branch, tag, remote or stash moving,
   * or HEAD moving or switching branch. One `for-each-ref` and one `rev-parse`; tens of milliseconds
   * even with thousands of refs.
   */
  async refsFingerprint(repoRoot: string): Promise<string> {
    const cli = this.cliForRoot(repoRoot);
    const [refs, head] = await Promise.all([
      cli.execRead(['for-each-ref', '--format=%(HEAD)%(objectname) %(refname)']),
      cli.execRead(['rev-parse', 'HEAD']).then(
        (result) => result.stdout.trim(),
        (error: unknown) => {
          // A repository without commits has no HEAD to read yet.
          log.debug('no HEAD commit for the graph fingerprint', error);
          return '';
        },
      ),
    ]);
    return createHash('sha1').update(head).update('\0').update(refs.stdout).digest('hex');
  }

  /** How many commits have been loaded for the repository, across the initial page and any more. */
  loadedCount(repoRoot: string): number {
    return this.stateByRepo.get(repoRoot)?.skip ?? 0;
  }

  /**
   * Reloads from the top as one page that is at least `depth` commits deep, when history has that many.
   * One `git log` for the whole depth: paging down to it 80 at a time made Git walk the history again for
   * every page (2000 deep in a large repository: 25 calls and seconds instead of one call).
   */
  async loadInitialThrough(repoRoot: string, depth: number): Promise<GraphPageDto> {
    this.stateByRepo.set(repoRoot, this.freshState(repoRoot));
    return this.fetchPage(repoRoot, false, Math.max(GRAPH_PAGE_SIZE, Math.ceil(depth / GRAPH_PAGE_SIZE) * GRAPH_PAGE_SIZE));
  }

  async loadMore(repoRoot: string, limit = GRAPH_PAGE_SIZE): Promise<GraphPageDto> {
    const current = this.stateByRepo.get(repoRoot);
    if (!current) {
      return this.loadInitial(repoRoot);
    }
    return this.fetchPage(repoRoot, true, limit);
  }

  /** Loads, in one git call, enough more commits to include the one at graph position `index`. */
  async loadThroughIndex(repoRoot: string, index: number): Promise<GraphPageDto> {
    const wanted = index + 1 + GRAPH_PAGE_SIZE - this.loadedCount(repoRoot);
    return this.loadMore(repoRoot, Math.min(MAX_JUMP_LOAD, Math.max(GRAPH_PAGE_SIZE, wanted)));
  }

  private async fetchPage(repoRoot: string, append: boolean, limit = GRAPH_PAGE_SIZE): Promise<GraphPageDto> {
    const cli = this.cliForRoot(repoRoot);
    let graphState = this.stateByRepo.get(repoRoot);
    if (!graphState) {
      graphState = this.freshState(repoRoot);
      this.stateByRepo.set(repoRoot, graphState);
    }

    const skip = append ? graphState.skip : 0;
    if (!append) {
      graphState.skip = 0;
    }

    // How the graph is shown and which stashes it carries are separate reads.
    const display = await this.graphDisplayFor(repoRoot, cli);
    const stashes = display.showStashes ? await this.loadStashEntries(cli) : [];
    const revision = graphLogRevision(
      graphState.filterRef,
      this.resolveHeadRef(repoRoot),
      display.activeBranchOnly,
    );
    const extraRevs = revision === ALL_COMMITS_FILTER ? stashes.map((entry) => entry.sha) : [];
    const result = await cli.execRead(
      buildGraphLogArgs(
        revision,
        skip,
        display.order,
        extraRevs,
        graphIncludesReflog(revision, display.showReflog),
        limit,
        { stashes: !display.showStashes, remoteBranches: !display.showRemoteBranches, tags: !display.showTags },
        display.collapseMerges,
      ),
    );
    const labelled = labelStashCommits(parseGitLog(result.stdout), stashes);
    const reflogOnly = graphIncludesReflog(revision, display.showReflog)
      ? await this.loadReflogOnlyShas(cli, extraRevs)
      : new Set<string>();
    const commits = this.withAvatars(
      reflogOnly.size > 0
        ? labelled.map((commit) => (reflogOnly.has(commit.sha) ? { ...commit, reflogOnly: true } : commit))
        : labelled,
      display.gravatar,
    );
    const hasMore = commits.length === limit;
    const oldestSha = commits.length > 0 ? commits[commits.length - 1].sha : null;

    graphState.skip = skip + commits.length;

    return {
      commits,
      hasMore,
      filterRef: revision,
      oldestSha,
      activeBranchOnly: display.activeBranchOnly,
      collapseMerges: display.collapseMerges,
    };
  }

  /** Looks up GitHub profile pictures when that setting is on; set by the window that owns the service. */
  githubAvatars: GitHubAvatars | undefined;

  private withAvatars(commits: GraphCommitDto[], gravatar: boolean): GraphCommitDto[] {
    const github = this.settings.graphGitHubAvatars() ? this.githubAvatars : undefined;
    if (!gravatar && !github) {
      return commits;
    }
    return commits.map((commit) => {
      if (!commit.authorEmail) {
        return commit;
      }
      // A GitHub picture when one is known; Gravatar, when that is on, for the rest.
      const avatarUrl = github?.known(commit.authorEmail) ?? (gravatar ? gravatarUrl(commit.authorEmail) : undefined);
      return avatarUrl ? { ...commit, avatarUrl } : commit;
    });
  }

  private displayForActiveRepo(): GraphDisplay | undefined {
    const root = this.gitService.getDiagnostics().repositories[0]?.rootPath;
    return root ? this.graphDisplayByRepo.get(root) : undefined;
  }

  private async graphDisplayFor(repoRoot: string, cli: GitCli): Promise<GraphDisplay> {
    const cached = this.graphDisplayByRepo.get(repoRoot);
    if (cached) {
      return cached;
    }
    const display = await this.readGraphDisplay(cli);
    this.graphDisplayByRepo.set(repoRoot, display);
    return display;
  }

  private async readGraphDisplay(cli: GitCli): Promise<GraphDisplay> {
    const base: GraphDisplay = {
      order: this.settings.graphOrder(),
      gravatar: this.settings.graphGravatar(),
      activeBranchOnly: this.activeBranchOnlyOverride ?? false,
      collapseMerges: getCollapseMerges(this.context),
      showReflog: this.showReflogBase(),
      showStashes: this.settings.graphShowStashes(),
      showRemoteBranches: this.settings.graphShowRemoteBranches(),
      showTags: this.settings.graphShowTags(),
    };
    try {
      const result = await cli.execRead(['config', '--local', '--get-regexp', REPO_GRAPH_CONFIG_REGEXP]);
      return applyRepoGraphOverrides(base, parseGitConfigPairs(result.stdout));
    } catch (error) {
      if (!(error instanceof GitCliError) || error.exitCode !== 1) {
        log.warn('could not read repository graph settings', error);
      }
      return base;
    }
  }

  private cliForRoot(repoRoot: string): GitCli {
    const repo = this.gitService.getRepositories().find((r) => r.rootUri.fsPath === repoRoot);
    if (!repo) {
      throw new RepositoryNotOpenError();
    }
    return this.cliRegistry.forRepository(repo);
  }

  /** Commits that only reflogs reach: everything `--reflog` adds beyond refs and stashes. */
  private async loadReflogOnlyShas(cli: GitCli, stashShas: readonly string[]): Promise<Set<string>> {
    try {
      const listed = await cli.execRead(['rev-list', '--reflog', '--not', '--all', ...stashShas]);
      return new Set(listed.stdout.split(/\r?\n/).filter(Boolean));
    } catch (error) {
      log.warn('could not list reflog-only commits for the graph', error);
      return new Set();
    }
  }

  private async loadStashEntries(cli: GitCli): Promise<StashEntryDto[]> {
    try {
      const listed = await cli.execRead(STASH_LIST_ARGS);
      return parseStashList(listed.stdout);
    } catch (error) {
      log.warn('could not list stashes for the graph', error);
      return [];
    }
  }

  private logRevisionArgs(revision: string): string[] {
    return graphIncludesReflog(revision, this.isShowReflog()) ? ['--reflog', revision] : [revision];
  }

  private freshState(repoRoot: string): RepoGraphState {
    return { filterRef: this.getFilterRef(repoRoot), skip: 0 };
  }
}

/** A search hit and where it sits in the graph's order. */
export interface SearchMatch {
  sha: string;
  index: number;
}

export interface SearchRecord {
  sha: string;
  author: string;
  email: string;
  message: string;
}

/** Parses `git log --format=%H%x00%an%x00%ae%x00%B%x01`. */
export function parseSearchRecords(output: string): SearchRecord[] {
  const records: SearchRecord[] = [];
  for (const chunk of output.split('\x01')) {
    const [sha = '', author = '', email = '', message = ''] = chunk.replace(/^\n+/, '').split('\x00');
    if (HASH_FULL.test(sha)) {
      records.push({ sha, author, email, message: message.trimEnd() });
    }
  }
  return records;
}

/** Whether a commit matches the way the graph search does: message, author, or a hash prefix. */
export function commitMatchesQuery(record: SearchRecord, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return false;
  }
  return (
    (HASH_PREFIX.test(needle) && record.sha.startsWith(needle)) ||
    record.message.toLowerCase().includes(needle) ||
    `${record.author} <${record.email}>`.toLowerCase().includes(needle)
  );
}
