import * as l10n from '@vscode/l10n';
import { html, nothing, render, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { classMap } from 'lit/directives/class-map.js';
import { live } from 'lit/directives/live.js';
import { repeat } from 'lit/directives/repeat.js';
import type { GitHubRepository } from '../../src/shared/history/githubReferences';
import { ACTION_ICONS, type ActionIcon } from '../../src/shared/app/actionIcons';
import { githubLinkedText } from '../githubLinkText';
import type {
  GraphCommitContext,
  GraphRefContext,
  GraphCommitDto,
  GraphGeometry,
  GraphHostMessage,
  GraphLaneRow,
  GraphPageDto,
  GraphRefDto,
  WebviewMessage,
} from '../protocol';
import {
  authorColor,
  authorInitials,
  bisectMarkForSha,
  withMergeSides,
  formatCommitDate,
  graphGeometry,
  IDLE_BISECT_STATE,
  layoutGraph,
  mergeNodeMarker,
  rowInkLanes,
  rowTextOffset,
  revealStep,
  firstMatchFrom,
  nextFindStep,
  compactGraphRefs,
  visibleGraphRefs,
  type BisectStateDto,
} from '../protocol';
import { rowSvgTemplate } from './graphRowSvg';
import {
  GRAPH_HEADER_HEIGHT,
  graphNavigationTarget,
  graphSelectionRange,
  isGraphNavigationKey,
  scrollTopToReveal,
} from '../../src/shared/graph/graphKeyboard';
import { preferredStartRef } from '../../src/shared/graph/startRef';
import { computeVirtualWindow, GRAPH_ROW_HEIGHT } from './virtualList';

import type { VscodeTextfield } from '@vscode-elements/elements/dist/vscode-textfield/index.js';

const LOAD_MORE_THRESHOLD_ROWS = 20;
const FIND_DEBOUNCE_MS = 250;

interface GraphRow {
  commit: GraphCommitDto;
  lane: GraphLaneRow;
  /** How many parents the commit has in history. A collapsed merge is drawn with one, so `commit` cannot say. */
  parentCount: number;
}

function isHeadCommit(commit: GraphCommitDto): boolean {
  return commit.refs.some((ref) => ref.isHead || ref.kind === 'head');
}

/** Each kind of ref has its own icon, so a badge says what it is before you read it. */
const REF_ICONS: Record<GraphRefDto['kind'], ActionIcon> = {
  head: 'branch',
  local: 'branch',
  remote: 'remoteBranch',
  tag: 'tag',
  stash: 'stash',
};

/** The branch a right-click on the row itself acts on: the checked-out one, else the first local, else a remote. */
function defaultMenuBranch(refs: readonly GraphRefDto[]): { name: string; kind: 'local' | 'remote' } | undefined {
  const local = refs.find((ref) => ref.kind === 'local' && ref.isHead) ?? refs.find((ref) => ref.kind === 'local');
  if (local) {
    return { name: local.name, kind: 'local' };
  }
  const remote = refs.find((ref) => ref.kind === 'remote');
  return remote ? { name: remote.name, kind: 'remote' } : undefined;
}

function refBadge(ref: GraphRefDto): TemplateResult {
  const current = ref.isHead === true || ref.kind === 'head';
  // A right-click on the badge points the Branch submenu at this branch; the row still supplies the commit.
  const context: GraphRefContext | undefined = ref.kind === 'local' || ref.kind === 'remote'
    ? { graphBranch: ref.name, graphBranchKind: ref.kind, preventDefaultContextMenuItems: true }
    : undefined;
  return html`<span class=${classMap({ 'graph-ref': true, [`graph-ref-${ref.kind}`]: true, 'graph-ref-current': current })}
    title=${[current ? (ref.kind === 'head' ? l10n.t('Detached HEAD') : l10n.t('Current branch: {0}', ref.name)) : ref.name, ...(ref.remotes ?? [])].join('\n')}
    data-vscode-context=${context ? JSON.stringify(context) : nothing}
    ><vscode-icon name=${ACTION_ICONS[REF_ICONS[ref.kind]]} aria-hidden="true"></vscode-icon>${ref.remotes
      ? html`<vscode-icon class="graph-ref-also-remote" name=${ACTION_ICONS.remoteBranch} aria-label=${l10n.t('Also on {0}', ref.remotes.join(', '))}></vscode-icon>`
      : nothing}<span class="graph-ref-name">${ref.isHead ? l10n.t('✓ {0}', ref.name) : ref.name}</span></span>`;
}

function avatar(commit: GraphCommitDto): TemplateResult {
  return html`<span class="graph-avatar" style=${styleMap({ background: `var(--graph-lane-${authorColor(commit.authorEmail)})` })}
    >${authorInitials(commit.author)}${commit.avatarUrl
      ? html`<img alt="" src=${commit.avatarUrl} @error=${(event: Event) => (event.target as HTMLElement).remove()}>`
      : nothing}</span>`;
}

export function mountGraphView(
  container: HTMLElement,
  postMessage: (message: WebviewMessage) => void,
): { handleHostMessage(message: GraphHostMessage): void } {
  render(nothing, container);

  let commits: GraphCommitDto[] = [];
  let filterRef = '';
  let activeBranchOnly = false;
  let compactBranchLabels = true;
  let github: GitHubRepository | null = null;
  let collapseMergesEnabled = false;
  let findQuery = '';
  let findPending = false;
  let matches: string[] = [];
  /** Graph position of each match, to load distant ones in one step. */
  let matchPositions = new Map<string, number>();
  /** Set when Enter was pressed with no further match found yet; the next batch answers it. */
  let waitingStep: 1 | -1 | null = null;
  /** The first batch of a new search jumps to the first match from the current row. */
  let awaitingFirstMatch = false;
  let findTimer: ReturnType<typeof setTimeout> | undefined;
  let matchSet = new Set<string>();
  let matchIndex = -1;
  const expandedMerges = new Set<string>();
  /** The commits each expanded merge brought in; Git lists only first-parent history while merges are collapsed. */
  const mergeSides = new Map<string, GraphCommitDto[]>();
  const selectedShas = new Set<string>();
  let anchorSha: string | null = null;
  /** Row the keyboard moves from: the last one clicked or arrowed to. */
  let cursorSha: string | null = null;
  let inspectTimer: ReturnType<typeof setTimeout> | undefined;
  let hasMore = false;
  let notice = '';
  let bisectState: BisectStateDto = IDLE_BISECT_STATE;
  let initialPageLoaded = false;
  let loadingMore = false;
  let pendingReveal: { ref: string; sha: string; pagesLoaded: number } | null = null;
  let layout: { rows: GraphRow[]; geometry: GraphGeometry } | null = null;
  let searchText = '';
  let showReflog = false;

  const scroller = (): HTMLElement => container.querySelector<HTMLElement>('.graph-scroll')!;
  const searchField = (): VscodeTextfield | null => container.querySelector<VscodeTextfield>('.graph-search');

  /** The text of the search field, and the clear button that shows only while there is text. */
  function setSearchText(text: string): void {
    searchText = text;
    paint();
  }

  function getLayout(): { rows: GraphRow[]; geometry: GraphGeometry } {
    if (!layout) {
      const visible = collapseMergesEnabled ? withMergeSides(commits, expandedMerges, mergeSides) : commits;
      const lanes = layoutGraph(visible).rows;
      const parentCounts = new Map([...commits, ...[...mergeSides.values()].flat()]
        .map((entry) => [entry.sha, entry.parents.length]));
      const maxLanes = lanes.reduce((max, row) => Math.max(max, rowInkLanes(row)), 1);
      layout = {
        rows: visible.map((commit, i) => ({
          commit, lane: lanes[i], parentCount: parentCounts.get(commit.sha) ?? commit.parents.length,
        })),
        geometry: graphGeometry(maxLanes),
      };
    }
    return layout;
  }

  /** The line under the search field: what is selected, how the search is going, and any notice. */
  function statusLine(): string {
    const parts: string[] = [];
    if (selectedShas.size > 1) {
      parts.push(l10n.t('{0} selected', selectedShas.size));
    }
    if (findQuery) {
      if (matches.length === 0) {
        parts.push(findPending ? l10n.t('Searching…') : l10n.t('No matches'));
      } else {
        parts.push(
          findPending
            ? l10n.t('{0} of {1}+ matches', matchIndex + 1, matches.length)
            : l10n.t('{0} of {1} matches', matchIndex + 1, matches.length),
        );
        if (findPending && waitingStep) {
          parts.push(l10n.t('Searching…'));
        }
      }
    }
    if (bisectState.summary) {
      parts.push(bisectState.summary);
    }
    if (notice) {
      parts.push(notice);
    }
    return parts.join(' · ');
  }

  function orderedSelection(): string[] {
    return getLayout()
      .rows.map((row) => row.commit.sha)
      .filter((sha) => selectedShas.has(sha));
  }

  function inspectCommit(sha: string): void {
    const commit = commits.find((entry) => entry.sha === sha);
    if (!commit) {
      return;
    }
    postMessage({ type: 'commitDetailsPreview', commit });
    postMessage({ type: 'commitTreeSetRevision', revision: sha });
    postMessage({ type: 'commitDetailsSelect', sha });
  }

  /** One commit shows its own changes; exactly two show the changes from the older to the newer. */
  function inspectSelection(clicked: string): void {
    const ordered = orderedSelection();
    if (ordered.length === 2) {
      // Rows run newest first, so the lower row is the older commit.
      const head = commits.find((entry) => entry.sha === ordered[0]);
      const base = commits.find((entry) => entry.sha === ordered[1]);
      if (head && base) {
        postMessage({ type: 'commitComparePreview', base, commit: head });
        postMessage({ type: 'commitTreeSetRevision', revision: head.sha });
        postMessage({ type: 'commitDetailsSelect', sha: head.sha, baseSha: base.sha });
        return;
      }
    }
    if (selectedShas.has(clicked)) {
      inspectCommit(clicked);
    } else if (ordered.length === 1) {
      inspectCommit(ordered[0]);
    }
  }

  /** Holding an arrow key crosses many rows; load details once it settles. */
  function scheduleInspect(sha: string): void {
    clearTimeout(inspectTimer);
    inspectTimer = setTimeout(() => inspectSelection(sha), 120);
  }

  function moveSelection(key: Parameters<typeof graphNavigationTarget>[0], extend: boolean): void {
    const rows = getLayout().rows;
    const current = cursorSha ? rows.findIndex((row) => row.commit.sha === cursorSha) : -1;
    const pageRows = Math.floor((scroller().clientHeight - GRAPH_HEADER_HEIGHT) / GRAPH_ROW_HEIGHT);
    const target = graphNavigationTarget(key, current, rows.length, pageRows);
    if (target < 0) {
      return;
    }
    const sha = rows[target].commit.sha;
    if (extend) {
      const anchored = anchorSha ? rows.findIndex((row) => row.commit.sha === anchorSha) : -1;
      const anchor = anchored >= 0 ? anchored : current >= 0 ? current : target;
      const [from, to] = graphSelectionRange(anchor, target);
      selectedShas.clear();
      for (let i = from; i <= to; i++) {
        selectedShas.add(rows[i].commit.sha);
      }
      anchorSha = rows[anchor].commit.sha;
    } else {
      selectedShas.clear();
      selectedShas.add(sha);
      anchorSha = sha;
    }
    cursorSha = sha;
    scroller().scrollTop = scrollTopToReveal(target, scroller().scrollTop, scroller().clientHeight);
    paint();
    scheduleInspect(sha);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.target !== e.currentTarget) {
      return;
    }
    if (isGraphNavigationKey(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      moveSelection(e.key, e.shiftKey);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      for (const row of getLayout().rows) {
        selectedShas.add(row.commit.sha);
      }
      paint();
    } else if (e.key === 'Escape' && selectedShas.size > 1 && cursorSha) {
      selectedShas.clear();
      selectedShas.add(cursorSha);
      anchorSha = cursorSha;
      paint();
      scheduleInspect(cursorSha);
    }
  }

  function select(sha: string, e: MouseEvent): void {
    clearTimeout(inspectTimer);
    cursorSha = sha;
    scroller().focus({ preventScroll: true });
    const rows = getLayout().rows;
    const anchor = anchorSha ? rows.findIndex((row) => row.commit.sha === anchorSha) : -1;
    const target = rows.findIndex((row) => row.commit.sha === sha);
    if (e.shiftKey && anchor >= 0 && target >= 0) {
      selectedShas.clear();
      for (let i = Math.min(anchor, target); i <= Math.max(anchor, target); i++) {
        selectedShas.add(rows[i].commit.sha);
      }
    } else if (e.metaKey || e.ctrlKey) {
      if (selectedShas.has(sha)) {
        selectedShas.delete(sha);
      } else {
        selectedShas.add(sha);
      }
      anchorSha = sha;
    } else {
      selectedShas.clear();
      selectedShas.add(sha);
      anchorSha = sha;
    }
    inspectSelection(sha);
    paint();
  }

  /** What a menu or shortcut acts on for `commit`. Matches the selection after a right-click: an unselected row becomes the only selection. */
  function contextFor(commit: GraphCommitDto, selected: boolean, selection: string[]): GraphCommitContext {
    const multi = selected && selection.length > 1;
    const stashSelector = commit.refs.find(
      (ref) => ref.kind === 'stash' && /^stash@\{\d+\}$/.test(ref.name),
    )?.name;
    const branch = defaultMenuBranch(commit.refs);
    const startRef = preferredStartRef(commit.refs);
    return {
      webviewSection: 'commit',
      graphSelection: multi ? 'multi' : 'single',
      sha: commit.sha,
      subject: commit.subject,
      shas: multi ? selection : [commit.sha],
      preventDefaultContextMenuItems: true,
      ...(stashSelector ? { stashSelector } : {}),
      ...(branch ? { graphBranch: branch.name, graphBranchKind: branch.kind } : {}),
      ...(startRef ? { graphStartRef: startRef } : {}),
    };
  }

  /** A shortcut acts on the selected commits, or on the row the cursor is on. */
  function runShortcut(action: 'copy' | 'remove'): void {
    // Copy and Delete in the search field mean its text, not a commit.
    if (document.activeElement?.matches('input, textarea, vscode-textfield, vscode-textarea')) {
      return;
    }
    const rows = getLayout().rows;
    const selection = rows.map((row) => row.commit.sha).filter((sha) => selectedShas.has(sha));
    const sha = cursorSha && selectedShas.has(cursorSha) ? cursorSha : selection[0];
    const commit = rows.find((row) => row.commit.sha === sha)?.commit;
    if (!commit) {
      return;
    }
    const context = contextFor(commit, true, selection);
    if (action === 'copy') {
      postMessage({
        type: 'graphContextCommand',
        id: context.graphSelection === 'multi' ? 'gitCheckout.graph.copyHashes' : 'gitCheckout.graph.copyHash',
        context,
      });
    } else if (context.graphSelection === 'single' && context.stashSelector) {
      postMessage({ type: 'graphContextCommand', id: 'gitCheckout.graph.stashDrop', context });
    } else if (context.graphSelection === 'single' && context.graphBranch) {
      postMessage({ type: 'graphContextCommand', id: 'gitCheckout.graph.deleteBranch', context });
    }
  }

  function toggleMerge(sha: string, collapsed: boolean): void {
    if (collapsed) {
      expandedMerges.add(sha);
      if (!mergeSides.has(sha)) {
        postMessage({ type: 'graphExpandMerge', sha });
      }
    } else {
      expandedMerges.delete(sha);
    }
    layout = null;
    paint();
  }

  function rowTemplate({ commit, lane, parentCount }: GraphRow, geometry: GraphGeometry, now: Date, selection: string[]): TemplateResult {
    const selected = selectedShas.has(commit.sha);
    const bisectMark = bisectMarkForSha(bisectState, commit.sha);
    const marker = mergeNodeMarker(parentCount, collapseMergesEnabled, expandedMerges.has(commit.sha));
    return html`
      <div class=${classMap({
        'graph-row': true, 'graph-grid': true,
        'graph-row-cursor': commit.sha === cursorSha, 'graph-row-selected': selected, 'graph-row-head': isHeadCommit(commit),
        'graph-row-reflog': commit.reflogOnly === true, 'graph-row-match': matchSet.has(commit.sha),
        'graph-row-bisect-good': bisectMark === 'good', 'graph-row-bisect-bad': bisectMark === 'bad',
        'graph-row-bisect-skip': bisectMark === 'skip',
      })} id="graph-row-${commit.sha}" role="option" aria-selected=${String(selected)}
        style=${styleMap({ height: `${GRAPH_ROW_HEIGHT}px` })}
        data-vscode-context=${JSON.stringify(contextFor(commit, selected, selection))}
        @click=${(event: MouseEvent) => select(commit.sha, event)}
        @contextmenu=${() => {
          if (!selectedShas.has(commit.sha)) {
            selectedShas.clear();
            selectedShas.add(commit.sha);
            anchorSha = commit.sha;
            cursorSha = commit.sha;
            inspectCommit(commit.sha);
            // Draw again after VS Code has read this row's data-vscode-context.
            requestAnimationFrame(paint);
          }
        }}>
        <div class="graph-main">
          ${rowSvgTemplate(lane, geometry, GRAPH_ROW_HEIGHT, isHeadCommit(commit), marker, (event) => {
            event.stopPropagation();
            toggleMerge(commit.sha, marker === 'collapsed');
          })}
          <div class="graph-cell graph-col-subject"
            style=${styleMap({ paddingLeft: `min(${rowTextOffset(lane, geometry)}px, calc(100% - 80px))`, '--ref-color': `var(--graph-lane-${lane.color})` })}>
            ${bisectMark ? html`<span class="graph-bisect-tag graph-bisect-tag-${bisectMark}">${bisectMark}</span>` : nothing}
            ${(compactBranchLabels ? compactGraphRefs(visibleGraphRefs(commit.refs, activeBranchOnly)) : visibleGraphRefs(commit.refs, activeBranchOnly)).map(refBadge)}
            <span class="graph-subject" title=${commit.subject}
            >${githubLinkedText(commit.subject, github, (url) => postMessage({ type: 'openGitHubLink', url }))}</span>
          </div>
        </div>
        <div class="graph-cell graph-col-author"
          title=${commit.authorEmail ? `${commit.author} <${commit.authorEmail}>` : commit.author}>${avatar(commit)}<span class="graph-author-name">${commit.author}</span></div>
        <div class="graph-cell graph-col-hash">${commit.sha.slice(0, 7)}</div>
        <div class="graph-cell graph-col-date">${formatCommitDate(commit.authorDate, now)}</div>
      </div>`;
  }

  /** A commit is always selected, so the bottom tabs always have one to show: the top one by default. */
  function selectTopCommitWhenNoneSelected(): void {
    if (selectedShas.size > 0 || pendingReveal) {
      return;
    }
    const top = getLayout().rows[0]?.commit.sha;
    if (!top) {
      return;
    }
    selectedShas.add(top);
    anchorSha = top;
    cursorSha = top;
    inspectCommit(top);
    paint();
  }

  /** Draws the view: the banner, the search field, the status line and the rows that are in view. */
  function paint(): void {
    const { rows, geometry } = getLayout();
    const scrolling = container.querySelector<HTMLElement>('.graph-scroll');
    const view = computeVirtualWindow(scrolling?.scrollTop ?? 0, scrolling?.clientHeight ?? 0, rows.length);
    const now = new Date();
    const selection = orderedSelection();
    const status = statusLine();
    render(html`
      <div class=${classMap({ 'graph-mode-banner': true, hidden: !showReflog })}>
        <span>${l10n.t('Reflog mode enabled')}</span>
        <vscode-button type="button" secondary class="graph-mode-banner-exit" @click=${() => postMessage({ type: 'graphExitReflog' })}>${l10n.t('Exit')}</vscode-button>
      </div>
      <div class=${classMap({ 'graph-mode-banner': true, 'graph-active-branch-banner': true, hidden: !activeBranchOnly })}>
        <span>${l10n.t('Filtered by the active branch')}</span>
        <vscode-button type="button" secondary class="graph-mode-banner-exit"
          @click=${() => postMessage({ type: 'graphExitActiveBranchOnly' })}>${l10n.t('Show All Branches')}</vscode-button>
      </div>
      <vscode-textfield class="graph-search" placeholder=${l10n.t('Search hash, author, or message')}
        aria-label=${l10n.t('Search commits')} title=${l10n.t('Enter or ↓: next match · Shift+Enter or ↑: previous · Escape: clear · Filters: author:name path:file since:2024-01-01 until:2024-06-30 content:text regex:pattern')}
        .value=${live(searchText)} @keydown=${onSearchKey} @input=${onSearchInput}>
        <vscode-toolbar-button slot="content-after" icon="close" label=${l10n.t('Clear search')} title=${l10n.t('Clear search')}
          style=${styleMap({ visibility: searchText ? '' : 'hidden' })}
          @click=${() => { clearFind(); searchField()?.focus(); }}></vscode-toolbar-button>
      </vscode-textfield>
      <div class=${classMap({ 'graph-status': true, hidden: status === '' })}><span class="graph-status-text">${status}</span></div>
      <!-- One tab stop for the whole list; arrow keys move within it, like VS Code's own lists. -->
      <div class="graph-scroll" tabindex="0" role="listbox" aria-multiselectable="true" aria-label=${l10n.t('Commits')}
        aria-activedescendant=${cursorSha && rows.slice(view.start, view.end).some((row) => row.commit.sha === cursorSha) ? `graph-row-${cursorSha}` : nothing}
        @keydown=${onKeydown} @scroll=${() => { paint(); maybeLoadMore(); }}>
        <div class="graph-columns graph-grid">
          <div class="graph-cell graph-col-commit">${l10n.t('Commit')}</div>
          <div class="graph-cell graph-col-author">${l10n.t('Author')}</div>
          <div class="graph-cell graph-col-hash">${l10n.t('Hash')}</div>
          <div class="graph-cell graph-col-date">${l10n.t('Date')}</div>
        </div>
        <div class="graph-spacer" style=${styleMap({ height: `${view.totalHeight}px` })}></div>
        <div class="graph-list" style=${styleMap({ transform: `translateY(${view.offsetY}px)` })}>
          ${repeat(rows.slice(view.start, view.end), (row) => row.commit.sha, (row) => rowTemplate(row, geometry, now, selection))}
        </div>
      </div>`, container);
  }

  function maybeLoadMore(): void {
    if (!hasMore || loadingMore || !initialPageLoaded) {
      return;
    }
    const remaining = scroller().scrollHeight - scroller().scrollTop - scroller().clientHeight;
    if (remaining < LOAD_MORE_THRESHOLD_ROWS * GRAPH_ROW_HEIGHT) {
      loadingMore = true;
      postMessage({ type: 'graphLoadMore' });
    }
  }

  function revealRow(sha: string): void {
    selectedShas.clear();
    selectedShas.add(sha);
    anchorSha = sha;
    cursorSha = sha;
    const index = getLayout().rows.findIndex((row) => row.commit.sha === sha);
    if (index >= 0) {
      scroller().scrollTop = Math.max(0, index * GRAPH_ROW_HEIGHT - scroller().clientHeight / 2);
    }
    paint();
    inspectCommit(sha);
  }

  function continueReveal(): void {
    if (!pendingReveal || !initialPageLoaded || loadingMore) {
      return;
    }
    const loaded = new Set(commits.map((c) => c.sha));
    const step = revealStep(loaded, pendingReveal.sha, hasMore, pendingReveal.pagesLoaded);
    if (step === 'found') {
      const { sha } = pendingReveal;
      pendingReveal = null;
      revealRow(sha);
    } else if (step === 'loadMore') {
      pendingReveal.pagesLoaded += 1;
      loadingMore = true;
      postMessage({ type: 'graphLoadMore' });
    } else {
      notice = l10n.t('{0} is not in this view', pendingReveal.ref);
      pendingReveal = null;
      paint();
    }
  }

  function resetFind(): void {
    findQuery = '';
    findPending = false;
    matches = [];
    matchPositions = new Map();
    matchSet = new Set();
    matchIndex = -1;
    waitingStep = null;
    awaitingFirstMatch = false;
  }

  function runFind(query: string): void {
    if (!query) {
      clearFind();
      return;
    }
    resetFind();
    findQuery = query;
    findPending = true;
    awaitingFirstMatch = true;
    paint();
    paint();
    postMessage({ type: 'graphFind', query });
  }

  function onSearchKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      clearFind();
      return;
    }
    if (e.key !== 'Enter' && e.key !== 'ArrowDown' && e.key !== 'ArrowUp') {
      return;
    }
    e.preventDefault();
    const query = searchText.trim();
    if (query !== findQuery) {
      if (e.key === 'Enter') {
        runFind(query);
      }
      return;
    }
    stepFind(e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey) ? -1 : 1);
  }

  /** Search as you type; the scan runs in the background and jumps to the first match it finds. */
  function onSearchInput(e: Event): void {
    searchText = (e.target as VscodeTextfield).value;
    paint();
    clearTimeout(findTimer);
    findTimer = setTimeout(() => {
      const query = searchText.trim();
      if (query !== findQuery) {
        runFind(query);
      }
    }, FIND_DEBOUNCE_MS);
  }

  function clearFind(): void {
    clearTimeout(findTimer);
    if (findQuery) {
      postMessage({ type: 'graphFindCancel' });
    }
    resetFind();
    setSearchText('');
    paint();
  }

  /** Enter (or Shift+Enter): the next match, waiting for the background search when it has not got there yet. */
  function stepFind(delta: 1 | -1): void {
    const step = nextFindStep(matchIndex, matches.length, !findPending, delta);
    if (step.kind === 'goto') {
      goToMatch(step.index);
      return;
    }
    waitingStep = step.kind === 'wait' ? delta : null;
    paint();
  }

  function goToMatch(index: number): void {
    waitingStep = null;
    matchIndex = index;
    if (index < 0) {
      paint();
      return;
    }
    const sha = matches[index];
    notice = '';
    pendingReveal = { ref: sha.slice(0, 7), sha, pagesLoaded: 0 };
    const position = matchPositions.get(sha);
    if (position !== undefined && !commits.some((commit) => commit.sha === sha) && !loadingMore) {
      // Far down the history: fetch everything down to it at once rather than a page at a time.
      loadingMore = true;
      postMessage({ type: 'graphLoadThrough', index: position });
    }
    continueReveal();
    paint();
  }

  /** Takes a batch of background results: the first one jumps to a match, and a pending Enter moves on. */
  function applyFindBatch(shas: string[], positions: number[], done: boolean): void {
    for (const [i, sha] of shas.entries()) {
      if (!matchSet.has(sha)) {
        matchSet.add(sha);
        matches.push(sha);
        matchPositions.set(sha, positions[i]);
      }
    }
    findPending = !done;
    paint();
    if (awaitingFirstMatch) {
      const rows = new Map(getLayout().rows.map((row, i) => [row.commit.sha, i]));
      const current = cursorSha ? (rows.get(cursorSha) ?? -1) : -1;
      const first = firstMatchFrom(matches, rows, current);
      if (first >= 0) {
        awaitingFirstMatch = false;
        goToMatch(first);
      } else if (done) {
        awaitingFirstMatch = false;
        if (matches.length > 0) {
          goToMatch(0);
        }
      }
    } else if (waitingStep) {
      stepFind(waitingStep);
    }
    paint();
  }

  function applyCollapseMerges(enabled: boolean): boolean {
    if (collapseMergesEnabled === enabled) {
      return false;
    }
    collapseMergesEnabled = enabled;
    expandedMerges.clear();
    mergeSides.clear();
    layout = null;
    return true;
  }

  function applyPage(page: GraphPageDto, append: boolean, keepView = false): void {
    loadingMore = false;
    const filterChanged = !append && filterRef !== '' && page.filterRef !== filterRef;
    // A refresh can put new commits above the ones in view; remember which commit is at the top of the view
    // and how far into its row, so the same commit can be put back there.
    let viewAnchor: { sha: string; offset: number } | undefined;
    if (!append && keepView) {
      const top = scroller().scrollTop;
      const first = Math.floor(top / GRAPH_ROW_HEIGHT);
      const sha = getLayout().rows[first]?.commit.sha;
      if (sha) { viewAnchor = { sha, offset: top - first * GRAPH_ROW_HEIGHT }; }
    }
    if (append) {
      // A refresh can land while a page is in flight, so the same commit may arrive twice.
      const known = new Set(commits.map((commit) => commit.sha));
      commits = [...commits, ...page.commits.filter((commit) => !known.has(commit.sha))];
    } else {
      commits = [...page.commits];
    }
    layout = null;
    if (!append && keepView) {
      const present = new Set(commits.map((commit) => commit.sha));
      for (const sha of [...selectedShas]) {
        if (!present.has(sha)) {
          selectedShas.delete(sha);
        }
      }
      anchorSha = anchorSha && present.has(anchorSha) ? anchorSha : null;
      cursorSha = cursorSha && present.has(cursorSha) ? cursorSha : null;
      initialPageLoaded = true;
    } else if (!append) {
      selectedShas.clear();
      anchorSha = null;
      cursorSha = null;
      notice = '';
      initialPageLoaded = true;
      scroller().scrollTop = 0;
    }
    hasMore = page.hasMore;
    filterRef = page.filterRef;
    activeBranchOnly = page.activeBranchOnly;
    applyCollapseMerges(page.collapseMerges);
    paint();
    if (viewAnchor) {
      const index = getLayout().rows.findIndex((row) => row.commit.sha === viewAnchor.sha);
      if (index >= 0) {
        scroller().scrollTop = index * GRAPH_ROW_HEIGHT + viewAnchor.offset;
        paint();
      }
    }
    continueReveal();
    if (!append) {
      selectTopCommitWhenNoneSelected();
    }
    maybeLoadMore();
    if (filterChanged && findQuery) {
      runFind(findQuery);
    }
  }

  paint();
  postMessage({ type: 'graphReady' });

  return {
    handleHostMessage(message: GraphHostMessage): void {
      switch (message.type) {
        case 'graphPage':
          applyPage(message.page, message.append, message.keepView);
          break;
        case 'graphAvatars': {
          const pictureOf = (commit: GraphCommitDto): GraphCommitDto => {
            const avatarUrl = message.avatars[commit.authorEmail.trim().toLowerCase()];
            return avatarUrl ? { ...commit, avatarUrl } : commit;
          };
          commits = commits.map(pictureOf);
          for (const [sha, side] of mergeSides) {
            mergeSides.set(sha, side.map(pictureOf));
          }
          layout = null;
          paint();
          break;
        }
        case 'graphMergeSide':
          mergeSides.set(message.sha, message.commits);
          layout = null;
          paint();
          break;
        case 'graphMeta':
          filterRef = message.filterRef;
          activeBranchOnly = message.activeBranchOnly;
          compactBranchLabels = message.compactBranchLabels !== false;
          github = message.github;
          showReflog = message.showReflog;
          applyCollapseMerges(message.collapseMerges);
          paint();
          break;
        case 'graphLoadFailed':
          loadingMore = false;
          pendingReveal = null;
          break;
        case 'graphReveal':
          notice = '';
          if (message.reachable) {
            pendingReveal = { ref: message.ref, sha: message.sha, pagesLoaded: 0 };
            continueReveal();
          } else {
            pendingReveal = null;
            notice = l10n.t('{0} is not in this view', message.ref);
            paint();
          }
          break;
        case 'graphFocusSearch':
          searchField()?.focus();
          if (message.query !== undefined) {
            setSearchText(message.query);
            runFind(message.query.trim());
          }
          searchField()?.wrappedElement.select();
          break;
        case 'graphShortcut':
          if (message.action === 'findNext' || message.action === 'findPrevious') {
            stepFind(message.action === 'findNext' ? 1 : -1);
          } else {
            runShortcut(message.action);
          }
          break;
        case 'graphFindResult':
          if (message.query.trim() === findQuery) {
            applyFindBatch(message.shas, message.positions, message.done);
          }
          break;
        case 'graphClear':
          commits = [];
          layout = null;
          hasMore = false;
          initialPageLoaded = false;
          loadingMore = false;
          pendingReveal = null;
          notice = '';
          resetFind();
          setSearchText('');
          collapseMergesEnabled = false;
          github = null;
          expandedMerges.clear();
          mergeSides.clear();
          selectedShas.clear();
          anchorSha = null;
          bisectState = IDLE_BISECT_STATE;
          paint();
          break;
        case 'graphBisect':
          bisectState = message.state;
          paint();
          break;
      }
    },
  };
}
