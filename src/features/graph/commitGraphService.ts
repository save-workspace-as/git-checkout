import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readSync } from 'node:fs';
import { join } from 'node:path';
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
import { COMMIT_GRAPH_HEADER_BYTES, objectsSizeKiB, wantsCommitGraph, LARGE_REPOSITORY_KIB, type CommitGraphState } from './commitGraphFile';
import { loadBranchActivity, MAX_FILTERED_REFS, refsFilteredOut, type BranchFilter } from '../branches/branchFilter';
import { sameWorktreePath } from '../worktrees/worktreeParser';
import { graphLogRevision } from '../../shared/graph/activeBranchGraph';
import {
    getCollapseMerges,
    getFilterRef,
    getBranchFilter,
    getHiddenRefs,
    setBranchFilter,
    setCollapseMerges,
    setFilterRef,
    setHiddenRefs,
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
import { revisionArg } from '../../core/gitRevision';

const log = createLogger('graph');

export const GRAPH_PAGE_SIZE = 80;
/**
 * Pages after the first. A page costs Git a walk from the newest commit whatever its size (about 100 ms on a repository
 * with 170 000 commits, and 130 ms for 2000 of them), so fewer, larger pages load history faster while scrolling.
 */
export const GRAPH_MORE_PAGE_SIZE = GRAPH_PAGE_SIZE * 3;

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
  /** Full names of single refs, such as `refs/heads/topic`, that a person hid. */
  refs?: readonly string[];
}

function hiddenRefPatterns(hide: HiddenGraphRefs): string[] {
  return [
    ...(hide.stashes ? ['refs/stash'] : []),
    ...(hide.remoteBranches ? ['refs/remotes/*'] : []),
    ...(hide.tags ? ['refs/tags/*'] : []),
    ...(hide.refs ?? []),
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
const COMMIT_GRAPH_WRITE_TIMEOUT_MS = 30 * 60_000;
const HASH_PREFIX = /^[0-9a-f]{4,64}$/i;
const HASH_FULL = /^[0-9a-f]{40,64}$/i;

export function defaultStartRef(filterRef: string, headRef: string | null): string {
  return filterRef === ALL_COMMITS_FILTER ? (headRef ?? 'HEAD') : filterRef;
}

interface RepoGraphState {
  filterRef: string;
  skip: number;
  /** Branches the branch filter leaves out, read with the first page so the later pages hide the same ones. */
  filteredOut: string[];
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

  private readonly commitGraphChecked = new Set<string>();

  /**
   * On a large repository without a commit-graph file that has changed paths, writes one in the background, once per
   * session: Git then walks history, lists a file's history and blames several times faster (on a clone of VS Code a first
   * page of the graph takes 0.1 s with the file and over 1 s without, and blame of a file 0.5 s against 1.4 s). It is the
   * file `git gc` writes, and the `gitCheckout.git.writeCommitGraph` setting turns this off. Reads go on while it is written.
   */
  async maintainCommitGraph(repoRoot: string, largeKiB = LARGE_REPOSITORY_KIB): Promise<void> {
    if (!this.settings.gitWriteCommitGraph() || this.commitGraphChecked.has(repoRoot)) {
      return;
    }
    this.commitGraphChecked.add(repoRoot);
    try {
      const cli = this.cliForRoot(repoRoot);
      const sizeKiB = objectsSizeKiB((await cli.execRead(['count-objects', '-v'])).stdout);
      const { commonDir } = await cli.resolveGitDirectories();
      if (!wantsCommitGraph(sizeKiB, readCommitGraphState(join(commonDir, 'objects', 'info')), largeKiB)) {
        return;
      }
      log.info(`writing the commit-graph file of ${repoRoot} (${Math.round(sizeKiB / 1024)} MB of objects)`);
      await cli.execWrite(['commit-graph', 'write', '--reachable', '--changed-paths'], { concurrent: true, timeoutMs: COMMIT_GRAPH_WRITE_TIMEOUT_MS });
      log.info(`wrote the commit-graph file of ${repoRoot}`);
    } catch (error) {
      log.warn('could not write the commit-graph file', error);
    }
  }

  /** The refs hidden from the graph of `repoRoot`, as full names. */
  hiddenRefs(repoRoot: string): string[] {
    return getHiddenRefs(this.context, repoRoot);
  }

  /** Which branches the sidebar and the graph of `repoRoot` list. */
  branchFilter(repoRoot: string): BranchFilter {
    return getBranchFilter(this.context, repoRoot);
  }

  setBranchFilter(repoRoot: string, filter: BranchFilter): void {
    setBranchFilter(this.context, repoRoot, filter);
  }

  /** Hides `refs` from the graph of `repoRoot`, or shows them again. */
  setRefsHidden(repoRoot: string, refs: readonly string[], hidden: boolean): void {
    const rest = getHiddenRefs(this.context, repoRoot).filter((ref) => !refs.includes(ref));
    setHiddenRefs(this.context, repoRoot, hidden ? [...rest, ...refs] : rest);
  }

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
    // so a match keeps the row it has in the graph. The two read the history side by side, since each costs
    // seconds on a large repository, and the scan holds its records until the list is there.
    let allowed: Set<string> | undefined;
    let rejected = false;
    const filtering = filters
      ? cli.execRead(
        ['log', '--format=%H', ...filters.args, ...revision, ...(filters.path ? ['--', filters.path] : [])],
        { timeoutMs: SEARCH_READ_TIMEOUT_MS },
      ).then(
        (result) => { allowed = new Set(result.stdout.split(/\r?\n/).filter(Boolean)); },
        (error: unknown) => {
          if (!parsed.regex) {
            throw error;
          }
          // A pattern that is still being typed, such as an open parenthesis, is not a regular expression yet.
          log.debug('search pattern was rejected by git', error);
          rejected = true;
        },
      )
      : undefined;
    // One git process for the whole scan: a `--skip` per chunk makes Git walk the history again each time, which on a
    // large repository costs far more than the walk itself. The output is read as it arrives, in batches of
    // SEARCH_CHUNK_SIZE commits, and the process is ended as soon as the search is cancelled.
    const parser = new SearchRecordParser();
    let scanned = 0;
    let total = 0;
    let pending: SearchMatch[] = [];
    let failed = false;
    const flush = (done: boolean): void => {
      const matches = pending;
      pending = [];
      onBatch(matches, done);
    };
    /** Counts one commit of the scan, in graph order; false once a batch was handed over and the search was cancelled meanwhile. */
    const count = (sha: string, textMatches: boolean): boolean => {
      if ((allowed ? allowed.has(sha) : true) && textMatches) {
        pending.push({ sha, index: scanned });
        total += 1;
      }
      scanned += 1;
      if (scanned % SEARCH_CHUNK_SIZE === 0) {
        flush(false);
        if (isCancelled()) {
          return false;
        }
      }
      return true;
    };
    // Until the list from the filters is there, the scan keeps what each commit says of the text.
    let filterReady = filtering === undefined;
    const held: { sha: string; textMatches: boolean }[] = [];
    const release = (): boolean => {
      filterReady = true;
      return held.splice(0).every((entry) => count(entry.sha, entry.textMatches));
    };
    const take = (records: SearchRecord[]): boolean => {
      for (const record of records) {
        const textMatches = trimmed ? commitMatchesQuery(record, trimmed) : true;
        if (!filterReady) {
          held.push({ sha: record.sha, textMatches });
        } else if (!count(record.sha, textMatches)) {
          return false;
        }
      }
      return true;
    };
    const listed = filtering?.then(() => { if (!rejected) { release(); } }, (error: unknown) => { failed = true; throw error; });
    const scan = cli.execRead(
      [
        'log',
        order === 'topo' ? '--topo-order' : '--date-order',
        // The rows the graph shows: with collapsed merges, first-parent history only.
        ...(collapseMerges ? ['--first-parent'] : []),
        '--pretty=format:%H%x00%an%x00%ae%x00%B%x01',
        ...revision,
      ],
      { timeoutMs: SEARCH_READ_TIMEOUT_MS, onStdout: (chunk) => !isCancelled() && !failed && !rejected && take(parser.push(chunk)) },
    );
    await Promise.all([scan, listed]);
    if (rejected) {
      onBatch([], true);
      return;
    }
    if (isCancelled()) {
      return;
    }
    if (!take(parser.end())) {
      return;
    }
    log.debug(`search matched ${total} of ${scanned} commits`);
    flush(true);
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
      `${revisionArg(mergeSha)}^@`,
      `^${revisionArg(mergeSha)}^1`,
    ]);
    return this.withAvatars(parseGitLog(result.stdout), display.gravatar);
  }

  /** One commit, as a graph row shows it, wherever it is in the history. Undefined when the repository does not have it. */
  async loadCommit(repoRoot: string, sha: string): Promise<GraphCommitDto | undefined> {
    const cli = this.cliForRoot(repoRoot);
    const display = await this.graphDisplayFor(repoRoot, cli);
    const result = await cli.execRead(['log', '-n', '1', '--decorate=full', '--date=unix', `--pretty=format:${GRAPH_LOG_FORMAT}`, revisionArg(sha), '--']);
    return this.withAvatars(parseGitLog(result.stdout), display.gravatar)[0];
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
    const sha = (await cli.execRead(['rev-parse', '--verify', `${revisionArg(ref)}^{commit}`])).stdout.trim();
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

  async loadMore(repoRoot: string, limit = GRAPH_MORE_PAGE_SIZE): Promise<GraphPageDto> {
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
    if (!append) {
      graphState.filteredOut = await this.branchesFilteredOut(repoRoot, cli);
    }
    const revision = graphLogRevision(
      graphState.filterRef,
      this.resolveHeadRef(repoRoot),
      display.activeBranchOnly,
    );
    const extraRevs = revision === ALL_COMMITS_FILTER ? stashes.map((entry) => entry.sha) : [];
    let result: { stdout: string };
    try {
      result = await cli.execRead(
        buildGraphLogArgs(
          revision,
          skip,
          display.order,
          extraRevs,
          graphIncludesReflog(revision, display.showReflog),
          limit,
          { stashes: !display.showStashes, remoteBranches: !display.showRemoteBranches, tags: !display.showTags, refs: [...getHiddenRefs(this.context, repoRoot), ...graphState.filteredOut] },
          display.collapseMerges,
        ),
      );
    } catch (error) {
      if (append || graphState.filterRef === ALL_COMMITS_FILTER || !namesNoRevision(error)) {
        throw error;
      }
      // The saved filter is a branch or tag that is gone, and would fail every load until someone picked another.
      log.warn(`the graph filter '${graphState.filterRef}' no longer exists; showing all commits`, error);
      this.setFilterRef(repoRoot, ALL_COMMITS_FILTER);
      graphState.filterRef = ALL_COMMITS_FILTER;
      return this.fetchPage(repoRoot, false, limit);
    }
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

  /** The branches the branch filter leaves out of the graph, by full name. Too many to name, and none are left out. */
  private async branchesFilteredOut(repoRoot: string, cli: GitCli): Promise<string[]> {
    const filter = this.branchFilter(repoRoot);
    if (filter === 'all') {
      return [];
    }
    try {
      const activity = await loadBranchActivity(cli, filter);
      const refs = refsFilteredOut(filter, activity, Math.floor(Date.now() / 1000), this.resolveHeadRef(repoRoot));
      if (refs.length > MAX_FILTERED_REFS) {
        log.warn(`${refs.length} branches are left out by the '${filter}' filter, too many to hide from the graph by name`);
        return [];
      }
      return refs;
    } catch (error) {
      log.warn('could not apply the branch filter to the graph', error);
      return [];
    }
  }

  private freshState(repoRoot: string): RepoGraphState {
    return { filterRef: this.getFilterRef(repoRoot), skip: 0, filteredOut: [] };
  }
}

/** Whether Git failed because a revision it was given does not exist. */
export function namesNoRevision(error: unknown): boolean {
  return (
    error instanceof GitCliError &&
    /unknown revision|bad revision|ambiguous argument|not a valid object name|bad object/i.test(error.stderr)
  );
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

/** Reads the output of `git log --format=%H%x00%an%x00%ae%x00%B%x01` as it arrives, in pieces that can end anywhere. */
export class SearchRecordParser {
  private rest = '';

  /** The commits that the output so far completed. */
  push(chunk: string): SearchRecord[] {
    const text = this.rest + chunk;
    const end = text.lastIndexOf('\x01');
    if (end < 0) {
      this.rest = text;
      return [];
    }
    this.rest = text.slice(end + 1);
    return parseSearchRecords(text.slice(0, end + 1));
  }

  /** The last commit, once the output is over. */
  end(): SearchRecord[] {
    const text = this.rest;
    this.rest = '';
    return parseSearchRecords(text);
  }
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

/** What `objects/info` holds of a commit-graph: one file (with the start of it read), a chain of files, or nothing. */
function readCommitGraphState(infoDir: string): CommitGraphState {
  if (existsSync(join(infoDir, 'commit-graphs', 'commit-graph-chain'))) {
    return { kind: 'chain' };
  }
  const file = join(infoDir, 'commit-graph');
  if (!existsSync(file)) {
    return { kind: 'none' };
  }
  const header = new Uint8Array(COMMIT_GRAPH_HEADER_BYTES);
  const fd = openSync(file, 'r');
  try {
    const read = readSync(fd, header, 0, header.length, 0);
    return { kind: 'file', header: header.subarray(0, read) };
  } finally {
    closeSync(fd);
  }
}
