import { strict as assert } from 'node:assert';
import { before, beforeEach, describe, it } from 'node:test';
import type { GraphCommitDto, GraphHostMessage, GraphPageDto } from '../../src/shared/graph/graphProtocol';
import type { WebviewMessage } from '../protocol';
import { focus, installDom, resetDom } from '../testing/dom';
import { GRAPH_ROW_HEIGHT } from './virtualList';

type El = HTMLElement & Record<string, any>;
let mountGraphView: typeof import('./graphView').mountGraphView;

before(async () => {
  installDom();
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  ({ mountGraphView } = await import('./graphView'));
});
beforeEach(resetDom);

const commit = (letter: string, parents: string[] = [], extra: Partial<GraphCommitDto> = {}): GraphCommitDto => ({
  sha: letter.repeat(40), parents: parents.map((parent) => parent.repeat(40)), subject: `Commit ${letter}`,
  author: `Author ${letter}`, authorEmail: `${letter}@example.test`, authorDate: 1000, refs: [], ...extra,
});

const page = (commits: GraphCommitDto[], extra: Partial<GraphPageDto> = {}): GraphHostMessage => ({
  type: 'graphPage', append: false,
  page: { commits, hasMore: false, filterRef: 'HEAD', oldestSha: null, activeBranchOnly: false, collapseMerges: false, ...extra },
});

const meta = (extra: Partial<Extract<GraphHostMessage, { type: 'graphMeta' }>> = {}): GraphHostMessage => ({
  type: 'graphMeta', filterRef: 'HEAD', headRef: 'main', activeBranchOnly: false, collapseMerges: false,
  showReflog: false, github: null, ...extra,
});

function mount() {
  const container = document.createElement('div');
  document.body.append(container);
  const sent: WebviewMessage[] = [];
  const graph = mountGraphView(container, (message) => sent.push(message));
  const q = (selector: string) => container.querySelector(selector) as El;
  Object.defineProperty(q('.graph-scroll'), 'clientHeight', { value: 440, configurable: true });
  const rows = () => [...container.querySelectorAll('.graph-row')] as El[];
  const press = (target: Element, key: string, init: KeyboardEventInit = {}) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  const click = (target: Element, init: MouseEventInit = {}) =>
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  const selected = () => rows().filter((row) => row.getAttribute('aria-selected') === 'true').map((row) => row.id.slice(10, 11));
  const contextOf = (row: El) => JSON.parse(row.getAttribute('data-vscode-context')!);
  const types = () => sent.map((message) => message.type);
  return { container, graph, sent, q, rows, press, click, selected, contextOf, types };
}

const three = [commit('a', ['b']), commit('b', ['c']), commit('c')];
const settle = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

describe('commit graph', () => {
  it('says it is ready, draws the header, and shows the rows of a page with their columns', () => {
    const { graph, q, rows, sent } = mount();
    assert.deepEqual(sent, [{ type: 'graphReady' }]);
    assert.deepEqual([...document.querySelectorAll('.graph-columns .graph-cell')].map((cell) => cell.textContent),
      ['Commit', 'Author', 'Hash', 'Date']);
    graph.handleHostMessage(page(three));
    assert.equal(rows().length, 3);
    const first = rows()[0];
    assert.equal(first.querySelector('.graph-subject')!.textContent, 'Commit a');
    assert.equal(first.querySelector('.graph-author-name')!.textContent, 'Author a');
    assert.equal(first.querySelector('.graph-col-hash')!.textContent, 'a'.repeat(7));
    assert.ok(first.querySelector('svg .graph-node, svg .graph-node-merge'));
    assert.equal(q('.graph-spacer').style.height, '66px');
  });

  it('selects the top commit when none is selected, and shows its details', () => {
    const { graph, selected, types } = mount();
    graph.handleHostMessage(page(three));
    assert.deepEqual(selected(), ['a']);
    assert.deepEqual(types().slice(1), ['commitDetailsPreview', 'commitTreeSetRevision', 'commitDetailsSelect']);
  });

  it('selects a clicked commit, extends with Shift and toggles with Ctrl, comparing exactly two', () => {
    const { graph, rows, click, selected, sent } = mount();
    graph.handleHostMessage(page(three));
    click(rows()[1]);
    assert.deepEqual(selected(), ['b']);
    click(rows()[2], { shiftKey: true });
    assert.deepEqual(selected(), ['b', 'c']);
    const compare = sent.find((message) => message.type === 'commitComparePreview') as { base: GraphCommitDto; commit: GraphCommitDto };
    assert.equal(compare.commit.sha, 'b'.repeat(40));
    assert.equal(compare.base.sha, 'c'.repeat(40));
    click(rows()[0], { ctrlKey: true });
    assert.deepEqual(selected(), ['a', 'b', 'c']);
    click(rows()[0], { ctrlKey: true });
    assert.deepEqual(selected(), ['b', 'c']);
  });

  it('moves the selection with the arrow keys and inspects it once the keys settle', async () => {
    const { graph, q, press, selected, types, rows, click } = mount();
    graph.handleHostMessage(page(three));
    click(rows()[0]);
    const before = types().length;
    press(q('.graph-scroll'), 'ArrowDown');
    press(q('.graph-scroll'), 'ArrowDown');
    assert.deepEqual(selected(), ['c']);
    assert.equal(q('.graph-scroll').getAttribute('aria-activedescendant'), `graph-row-${'c'.repeat(40)}`);
    assert.equal(types().length, before, 'nothing is inspected while keys are held');
    await settle(200);
    assert.ok(types().slice(before).includes('commitDetailsPreview'));
    press(q('.graph-scroll'), 'ArrowUp', { shiftKey: true });
    assert.deepEqual(selected(), ['b', 'c']);
    // The cursor is on the row the selection was extended to, and Escape narrows the selection to it.
    press(q('.graph-scroll'), 'Escape');
    assert.deepEqual(selected(), ['b']);
    press(q('.graph-scroll'), 'a', { ctrlKey: true });
    assert.deepEqual(selected(), ['a', 'b', 'c']);
  });

  it('gives each row the context the menus act on, and a selected row the whole selection', () => {
    const { graph, rows, click, contextOf } = mount();
    graph.handleHostMessage(page([
      commit('a', ['b'], { refs: [{ kind: 'local', name: 'main', isHead: true }, { kind: 'tag', name: 'v1' }] }),
      commit('b', ['c'], { refs: [{ kind: 'stash', name: 'stash@{0}' }] }),
      commit('c'),
    ] as GraphCommitDto[]));
    const single = contextOf(rows()[0]);
    assert.equal(single.graphSelection, 'single');
    assert.equal(single.graphBranch, 'main');
    assert.equal(single.graphBranchKind, 'local');
    assert.equal(single.graphStartRef, 'main');
    assert.equal(contextOf(rows()[1]).stashSelector, 'stash@{0}');
    click(rows()[2], { ctrlKey: true });
    const multi = contextOf(rows()[0]);
    assert.equal(multi.graphSelection, 'multi');
    assert.deepEqual(multi.shas, ['a'.repeat(40), 'c'.repeat(40)]);
  });

  it('labels a branch badge so its menu acts on that branch, and marks the current one', () => {
    const { graph, rows } = mount();
    graph.handleHostMessage(meta({ compactBranchLabels: false }));
    graph.handleHostMessage(page([commit('a', [], { refs: [
      { kind: 'local', name: 'main', isHead: true }, { kind: 'remote', name: 'origin/main' }, { kind: 'tag', name: 'v1' },
    ] })]));
    const badges = [...rows()[0].querySelectorAll('.graph-ref')] as El[];
    assert.deepEqual(badges.map((badge) => badge.querySelector('.graph-ref-name')!.textContent), ['✓ main', 'origin/main', 'v1']);
    assert.equal(badges[0].classList.contains('graph-ref-current'), true);
    assert.equal(JSON.parse(badges[1].getAttribute('data-vscode-context')!).graphBranch, 'origin/main');
    assert.equal(badges[2].hasAttribute('data-vscode-context'), false);
  });

  it('shows a branch and its remote-tracking branch as one label with a remote icon', () => {
    const { graph, rows } = mount();
    graph.handleHostMessage(page([commit('a', [], { refs: [
      { kind: 'local', name: 'main', isHead: true }, { kind: 'remote', name: 'origin/main' },
    ] })]));
    const badges = [...rows()[0].querySelectorAll('.graph-ref')] as El[];
    assert.equal(badges.length, 1);
    assert.match(badges[0].getAttribute('title') ?? badges[0].innerHTML, /origin\/main/);
  });

  it('shows the reflog banner while that mode is on, and exits it', () => {
    const { graph, q, sent } = mount();
    assert.equal(q('.graph-mode-banner').classList.contains('hidden'), true);
    graph.handleHostMessage(meta({ showReflog: true }));
    assert.equal(q('.graph-mode-banner').classList.contains('hidden'), false);
    click(q('.graph-mode-banner-exit'));
    assert.deepEqual(sent.at(-1), { type: 'graphExitReflog' });
    function click(target: Element) { target.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  });

  it('shows GitHub pictures as they arrive, for every commit by that author', () => {
    const { graph, container } = mount();
    graph.handleHostMessage(page([commit('a', ['b'], { authorEmail: 'Ada@Example.com' }), commit('b', [], { authorEmail: 'ada@example.com' })]));
    assert.equal(container.querySelectorAll('.graph-avatar img').length, 0);
    graph.handleHostMessage({ type: 'graphAvatars', avatars: { 'ada@example.com': 'https://avatars.githubusercontent.com/u/1' } });
    const pictures = [...container.querySelectorAll('.graph-avatar img')].map((img) => img.getAttribute('src'));
    assert.deepEqual(pictures, ['https://avatars.githubusercontent.com/u/1', 'https://avatars.githubusercontent.com/u/1']);
  });

  it('says when the graph is filtered by the active branch, and shows every branch again', () => {
    const { graph, q, sent } = mount();
    const banner = () => q('.graph-active-branch-banner');
    assert.equal(banner().classList.contains('hidden'), true);
    graph.handleHostMessage(meta({ activeBranchOnly: true }));
    assert.equal(banner().classList.contains('hidden'), false);
    assert.match(banner().textContent ?? '', /Filtered by the active branch/);
    banner().querySelector('vscode-button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert.deepEqual(sent.at(-1), { type: 'graphExitActiveBranchOnly' });
  });

  describe('filter suggestions in the search', () => {
    const type = (field: El, value: string) => {
      field.value = value;
      field.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const items = (q: (selector: string) => El, container: HTMLElement) =>
      [...container.querySelectorAll('.graph-suggest-item .graph-suggest-label')].map((label) => label.textContent);

    it('offers the filters that start like the word being typed, and takes one with Enter or Tab', () => {
      const { container, graph, q, press } = mount();
      graph.handleHostMessage(page(three));
      const field = q('.graph-search');
      type(field, 'pa');
      assert.deepEqual(items(q, container), ['path:']);
      assert.equal(field.getAttribute('aria-expanded'), 'true');
      press(field, 'Enter');
      assert.equal(field.value, 'path:');
      assert.deepEqual(items(q, container), [], 'path takes text, so there is nothing more to offer');

      type(field, 's');
      press(field, 'Tab');
      assert.equal(field.value, 'since:');
      assert.ok(items(q, container).includes('yesterday'), 'the values of the filter are offered next');
    });

    it('offers the authors of the loaded commits for author:, quoting a name with a space', () => {
      const { container, graph, q, press } = mount();
      graph.handleHostMessage(page(three));
      const field = q('.graph-search');
      type(field, 'author:Author');
      assert.deepEqual(items(q, container), ['Author a', 'Author b', 'Author c']);
      press(field, 'ArrowDown');
      press(field, 'Enter');
      assert.equal(field.value, 'author:"Author b" ');
    });

    it('moves through the list with the arrows, and closes it with Escape before Escape clears the search', () => {
      const { container, graph, q, press, sent } = mount();
      graph.handleHostMessage(page(three));
      const field = q('.graph-search');
      type(field, 'author:Author');
      press(field, 'ArrowDown');
      assert.equal(q('.graph-suggest-item.selected .graph-suggest-label').textContent, 'Author b');
      press(field, 'ArrowUp'); press(field, 'ArrowUp');
      assert.equal(q('.graph-suggest-item.selected .graph-suggest-label').textContent, 'Author c', 'wraps around');
      press(field, 'Escape');
      assert.deepEqual(items(q, container), []);
      assert.equal(field.value, 'author:Author', 'the first Escape only closes the list');
      assert.equal(sent.some((message) => message.type === 'graphFindCancel'), false);
      press(field, 'Escape');
      assert.equal(field.value, '');
    });

    it('takes a suggestion with the mouse, and Ctrl+Space shows every filter', () => {
      const { container, graph, q, press, click } = mount();
      graph.handleHostMessage(page(three));
      const field = q('.graph-search');
      press(field, ' ', { ctrlKey: true });
      assert.deepEqual(items(q, container), ['author:', 'path:', 'since:', 'until:', 'content:', 'regex:']);
      click(container.querySelectorAll('.graph-suggest-item')[1]);
      assert.equal(field.value, 'path:');
    });

    it('does not offer anything for plain words, and leaves the arrows to the matches', () => {
      const { container, graph, q } = mount();
      graph.handleHostMessage(page(three));
      type(q('.graph-search'), 'fix login');
      assert.deepEqual(items(q, container), []);
    });
  });

  it('searches as you type, marks the matches, and steps through them with Enter', async () => {
    const { graph, q, rows, sent, press } = mount();
    graph.handleHostMessage(page(three));
    const field = q('.graph-search');
    field.value = 'Commit';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    assert.equal(q('.graph-search vscode-toolbar-button').style.visibility, '');
    await settle(300);
    assert.deepEqual(sent.at(-1), { type: 'graphFind', query: 'Commit' });
    assert.match(q('.graph-status-text').textContent, /Searching/);
    graph.handleHostMessage({ type: 'graphFindResult', query: 'Commit', shas: ['b'.repeat(40), 'c'.repeat(40)], positions: [1, 2], done: true });
    assert.deepEqual(rows().filter((row) => row.classList.contains('graph-row-match')).map((row) => row.id.slice(10, 11)), ['b', 'c']);
    assert.match(q('.graph-status-text').textContent, /1 of 2 matches/);
    press(field, 'Enter');
    assert.match(q('.graph-status-text').textContent, /2 of 2 matches/);
    press(field, 'Escape');
    assert.equal(sent.at(-1)?.type, 'graphFindCancel');
    assert.equal(field.value, '');
    assert.equal(q('.graph-status').classList.contains('hidden') || q('.graph-status-text').textContent === '', true);
  });

  it('copies the selected hash and removes its branch with the shortcuts, but not while typing in search', () => {
    const { graph, q, sent, click, rows } = mount();
    graph.handleHostMessage(page([commit('a', [], { refs: [{ kind: 'local', name: 'topic' }] }), commit('b')]));
    click(rows()[0]);
    graph.handleHostMessage({ type: 'graphShortcut', action: 'copy' });
    const copy = sent.at(-1) as { type: string; id: string };
    assert.deepEqual([copy.type, copy.id], ['graphContextCommand', 'gitCheckout.graph.copyHash']);
    graph.handleHostMessage({ type: 'graphShortcut', action: 'remove' });
    assert.equal((sent.at(-1) as { id: string }).id, 'gitCheckout.graph.deleteBranch');
    const count = sent.length;
    focus.active = q('.graph-search');
    graph.handleHostMessage({ type: 'graphShortcut', action: 'copy' });
    assert.equal(sent.length, count);
  });

  it('asks for more commits when scrolled near the end, once, and lists what arrives', () => {
    const { graph, q, sent, rows } = mount();
    graph.handleHostMessage(page(three, { hasMore: true }));
    const scroll = q('.graph-scroll');
    Object.defineProperty(scroll, 'scrollHeight', { value: 400, configurable: true });
    scroll.dispatchEvent(new Event('scroll'));
    scroll.dispatchEvent(new Event('scroll'));
    assert.equal(sent.filter((message) => message.type === 'graphLoadMore').length, 1);
    graph.handleHostMessage({ type: 'graphPage', append: true, page: { commits: [commit('d')], hasMore: false, filterRef: 'HEAD', oldestSha: null, activeBranchOnly: false, collapseMerges: false } });
    assert.equal(rows().length, 4);
  });

  it('collapses merge commits behind a node that loads and shows the merged-in side', () => {
    const { graph, rows, q, sent } = mount();
    // Git listed first-parent history only: a, its first parent b, then d. c came in with the merge.
    graph.handleHostMessage(page([commit('a', ['b', 'c']), commit('b', ['d']), commit('d')], { collapseMerges: true }));
    const mark = () => q('.graph-merge-mark')?.getAttribute('d');
    assert.match(mark() ?? '', /V/, 'a plus sign: it can be expanded');
    assert.equal(rows().length, 3);
    assert.equal(q('.graph-row path.graph-edge[d*="H"]') === null, true, 'no line leads off to a commit that is not listed');
    q('.graph-merge-hit').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert.deepEqual(sent.at(-1), { type: 'graphExpandMerge', sha: 'a'.repeat(40) });
    assert.doesNotMatch(mark() ?? '', /V/, 'a minus sign: it can be collapsed again');
    graph.handleHostMessage({ type: 'graphMergeSide', sha: 'a'.repeat(40), commits: [commit('c', ['d'])] });
    assert.deepEqual(rows().map((row) => row.id.slice(10, 11)), ['a', 'c', 'b', 'd']);
    // Collapsing and expanding again uses the side already loaded.
    q('.graph-merge-hit').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert.equal(rows().length, 3);
    const asked = sent.filter((message) => message.type === 'graphExpandMerge').length;
    q('.graph-merge-hit').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert.equal(rows().length, 4);
    assert.equal(sent.filter((message) => message.type === 'graphExpandMerge').length, asked);
  });

  it('clears everything when the repository goes away, and reveals a commit asked for', () => {
    const { graph, rows, selected } = mount();
    graph.handleHostMessage(page(three));
    graph.handleHostMessage({ type: 'graphReveal', ref: 'topic', sha: 'c'.repeat(40), reachable: true });
    assert.deepEqual(selected(), ['c']);
    graph.handleHostMessage({ type: 'graphClear' });
    assert.equal(rows().length, 0);
    graph.handleHostMessage({ type: 'graphReveal', ref: 'gone', sha: 'z'.repeat(40), reachable: false });
    assert.match(document.querySelector('.graph-status-text')!.textContent!, /gone is not in this view/);
  });

  it('marks the row of a revealed commit, then lets the mark go and keeps the selection', async () => {
    const { graph, rows, selected } = mount();
    graph.handleHostMessage(page(three));
    graph.handleHostMessage({ type: 'graphReveal', ref: 'topic', sha: 'c'.repeat(40), reachable: true });
    const flashing = () => rows().filter((row) => row.classList.contains('graph-row-flash')).map((row) => row.id.slice(10, 11));
    assert.deepEqual(flashing(), ['c']);
    await new Promise((done) => setTimeout(done, 1900));
    assert.deepEqual(flashing(), []);
    assert.deepEqual(selected(), ['c'], 'the commit stays selected');
  });

  it('keeps the same commits in view when a refresh puts new ones above them', () => {
    const { graph, q } = mount();
    const name = (index: number) => String.fromCharCode(97 + (index % 26)) + String.fromCharCode(97 + Math.floor(index / 26));
    const history = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => {
      const own = name(from + i);
      return commit(own, [name(from + i + 1)], { sha: own.padEnd(40, '0'), subject: `Commit ${own}` });
    });
    graph.handleHostMessage(page(history(0, 200)));
    const scroll = q('.graph-scroll');
    scroll.scrollTop = 80 * GRAPH_ROW_HEIGHT + 7;
    const before = history(0, 200).map((entry) => entry.sha);
    // Five new commits arrive on top; the commit that was 80 rows down is now 85 rows down.
    const refreshed = [...history(300, 305), ...history(0, 200)];
    graph.handleHostMessage({ ...(page(refreshed) as Extract<GraphHostMessage, { type: 'graphPage' }>), keepView: true });
    assert.equal(before.length, 200);
    assert.equal(scroll.scrollTop, 85 * GRAPH_ROW_HEIGHT + 7);
  });
});

