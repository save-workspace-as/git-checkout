import { strict as assert } from 'node:assert';
import { before, beforeEach, describe, it } from 'node:test';
import type { RebaseEditorStateDto, RebaseWebviewMessage } from './protocol';
import { focus, installDom, optionsOf, resetDom } from '../testing/dom';

type El = HTMLElement & Record<string, any>;
let mountRebaseView: typeof import('./rebaseView').mountRebaseView;

before(async () => {
  installDom();
  // happy-dom has the dialog element but not its modal behavior.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) { this.open = true; };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) { this.open = false; };
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element & { scrolledIntoView?: boolean }) {
    this.scrolledIntoView = true;
  };
  ({ mountRebaseView } = await import('./rebaseView'));
});
beforeEach(resetDom);

const key = (element: Element, name: string, init: KeyboardEventInit = {}) =>
  element.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }));
const click = (element: Element, init: MouseEventInit = {}) =>
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
const fire = (element: Element, type: string) => element.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
const choose = (select: El, value: string) => { select.value = value; fire(select, 'change'); };
const typeInto = (element: El, value: string) => { element.value = value; fire(element, 'input'); };

function createView() {
  const root = document.createElement('div');
  document.body.append(root);
  const sent: RebaseWebviewMessage[] = [];
  const detailRequests: string[] = [];
  const view = mountRebaseView(root, (message) => {
    if (message.type === 'rebaseRequestCommitDetails') { detailRequests.push(message.hash); } else { sent.push(message); }
  });
  const state: RebaseEditorStateDto = {
    repoRoot: '/fixture', onto: 'main', upstream: 'HEAD~2', branch: 'topic',
    updateRefs: true, stashDirty: false, riskyCount: 0, github: null,
    sequencer: { active: false, onto: null, headName: null, msgnum: 0, end: 0, summary: '' },
    lines: ['b', 'a'].map((letter) => ({ command: 'pick' as const, hash: letter.repeat(40), subject: `Commit ${letter}` })),
    commits: ['a', 'b'].map((letter) => ({
      sha: letter.repeat(40), parents: [], subject: `Commit ${letter}`,
      author: `Author ${letter}`, authorEmail: `${letter}@example.test`, authorDate: 1000, refs: [],
    })),
  };
  view.applyHostMessage({ type: 'rebaseBootstrap', state });
  const find = (className: string) => root.querySelector(`.${className}`) as El;
  const rows = () => [...find('rebase-list').children] as El[];
  const select = (row: El) => row.querySelector('vscode-single-select') as El;
  const subject = (row: El) => row.querySelector('.rebase-subject') as El;
  const heading = () => find('rebase-preview').querySelector('.commit-subject')!.textContent;
  return { root, sent, view, state, find, rows, select, subject, heading, detailRequests };
}

describe('rebase commit table and preview', () => {
  it('uses the shared summary and loads the selected message without stale selection updates or the old committer row', () => {
    const { view, state, find, rows, heading, detailRequests, sent } = createView();
    const first = state.lines[1].hash;
    const second = state.lines[0].hash;
    assert.deepEqual(detailRequests, [first]);
    assert.equal(find('rebase-preview').children[0].className, 'commit-meta');
    assert.equal(find('commit-avatar').textContent, 'AA');
    assert.equal(find('commit-author-label').textContent, 'Author');
    assert.equal(find('commit-author-name').textContent, 'Author a');
    assert.equal(find('commit-author-email').textContent, 'a@example.test');
    assert.ok(find('commit-author-date').textContent);
    assert.equal(find('commit-subject').localName, 'h2');
    state.github = { host: 'github.com', owner: 'test', repo: 'project' };
    state.commits[0].avatarUrl = 'https://example.test/avatar.png';
    state.commits[0].parents = ['f'.repeat(40)];
    view.applyHostMessage({ type: 'rebaseState', state });
    assert.equal(find('commit-avatar').children[0].getAttribute('src'), 'https://example.test/avatar.png');
    assert.ok([...find('commit-identity').querySelectorAll('*')].some((node) => node.textContent === 'fffffff'));
    click(find('commit-github'));
    assert.equal(JSON.stringify(sent.at(-1)), JSON.stringify({
      type: 'openGitHubLink', url: `https://github.com/test/project/commit/${first}`,
    }));
    click(rows()[1]);
    assert.deepEqual(detailRequests, [first, second]);
    const committer = { name: 'Committer', email: 'committer@example.test', date: 1001 };
    view.applyHostMessage({ type: 'rebaseCommitDetails', hash: first, body: 'First body', committer });
    assert.equal(heading(), 'Commit b');
    assert.equal(find('commit-details-message').textContent, '');
    view.applyHostMessage({ type: 'rebaseCommitDetails', hash: second, body: 'Second body\n\nMore details', committer });
    assert.equal(find('commit-details-message').textContent, 'Second body\n\nMore details');
    assert.equal(find('commit-details-message').classList.contains('hidden'), false);
    assert.deepEqual([...find('commit-identity').children].map((row) => row.children[0].textContent), ['Hash']);
    assert.equal(find('rebase-preview').textContent!.includes('committer@example.test'), false);
    click(rows()[0]);
    assert.equal(find('commit-details-message').textContent, 'First body');
    assert.deepEqual(detailRequests, [first, second]);
    state.lines[1].command = 'reword';
    state.lines[1].message = 'New subject\n\nEdited body';
    view.applyHostMessage({ type: 'rebaseState', state });
    assert.equal(heading(), 'New subject');
    assert.equal(find('commit-details-message').textContent, 'Edited body');
    state.lines[1].message = 'Subject only';
    view.applyHostMessage({ type: 'rebaseState', state });
    assert.equal(find('commit-details-message').classList.contains('hidden'), true);
  });

  it('surfaces summary loading errors, allows retry, and ignores replies after dismissal', () => {
    const { view, state, find, detailRequests } = createView();
    const hash = state.lines[1].hash;
    view.applyHostMessage({ type: 'rebaseCommitDetailsError', hash, message: 'Could not load commit' });
    assert.equal(find('rebase-error').classList.contains('hidden'), false);
    assert.equal(find('rebase-error').children[0].textContent, 'Could not load commit');
    view.applyHostMessage({ type: 'rebaseState', state });
    assert.deepEqual(detailRequests, [hash, hash]);
    view.applyHostMessage({ type: 'rebaseClose' });
    view.applyHostMessage({
      type: 'rebaseCommitDetails', hash, body: 'Late response',
      committer: { name: 'Committer', email: '', date: 0 },
    });
    assert.equal(find('commit-details-message').textContent, '');
    view.applyHostMessage({ type: 'rebaseCommitDetailsError', hash, message: 'Late error' });
    assert.equal(find('rebase-error').classList.contains('hidden'), true);
  });

  it('moves immediately on repeated Cmd+arrows and ignores delayed host orders without losing focus or connectors', () => {
    const { sent, view, state, find, rows } = createView();
    const lines: RebaseEditorStateDto['lines'] = [
      { hash: 'a', subject: 'Target A', command: 'pick' },
      { hash: 'b', subject: 'Target B', command: 'pick' },
      { hash: 'c', subject: 'Fold C', command: 'fixup' },
      { hash: 'd', subject: 'Target D', command: 'pick' },
    ];
    view.applyHostMessage({ type: 'rebaseState', state: { ...state, lines } });
    const order = () => rows().map((row) => row.dataset.hash);
    const activeRow = () => rows().find((row) => row.getAttribute('aria-selected') === 'true')!;
    click(rows()[1]);
    find('rebase-list').scrollTop = 35;
    key(focus.active as Element, 'ArrowDown', { metaKey: true });
    assert.deepEqual(order(), ['d', 'b', 'c', 'a']);
    assert.equal(activeRow().dataset.hash, 'c');
    assert.equal(activeRow().dataset.foldTarget, 'a');
    assert.equal(focus.active, activeRow().querySelector('.rebase-subject'));
    assert.equal(find('rebase-list').scrollTop, 35);
    key(focus.active as Element, 'ArrowUp', { metaKey: true });
    key(focus.active as Element, 'ArrowUp', { metaKey: true });
    assert.deepEqual(order(), ['c', 'd', 'b', 'a']);
    assert.equal(activeRow().dataset.foldTarget, 'd');
    assert.equal(JSON.stringify(sent.at(-1)), JSON.stringify({
      type: 'rebaseReorder', fromIndex: 2, toIndex: 3, reorderId: 3,
    }));
    view.applyHostMessage({ type: 'rebaseState', state: { ...state, lines: [lines[0], lines[2], lines[1], lines[3]], reorderId: 1 } });
    assert.deepEqual(order(), ['c', 'd', 'b', 'a']);
    assert.equal(activeRow().dataset.hash, 'c');
    const finalState = { ...state, lines: [lines[0], lines[1], lines[3], lines[2]], reorderId: 3 };
    view.applyHostMessage({ type: 'rebaseState', state: finalState });
    view.applyHostMessage({ type: 'rebaseState', state: { ...state, lines, reorderId: 2 } });
    assert.deepEqual(order(), ['c', 'd', 'b', 'a']);
    assert.equal(focus.active, activeRow().querySelector('.rebase-subject'));
  });

  it('surfaces reorder errors and refreshes the authoritative order', () => {
    const { sent, view, state, find, rows } = createView();
    click(rows()[0]);
    key(focus.active as Element, 'ArrowDown', { metaKey: true });
    view.applyHostMessage({ type: 'rebaseError', message: 'Unable to reorder' });
    assert.equal(sent.at(-1)?.type, 'rebaseRefresh');
    assert.equal(find('rebase-error').children[0].textContent, 'Unable to reorder');
    view.applyHostMessage({ type: 'rebaseState', state });
    assert.deepEqual(rows().map((row) => row.dataset.hash), [...state.lines].reverse().map((line) => line.hash));
  });

  it('focuses clicked rows, navigates with arrows, and moves the focused commit with Cmd+arrows', () => {
    const { sent, view, state, rows, select, subject, heading } = createView();
    click(rows()[0]);
    assert.equal(focus.active, subject(rows()[0]));
    key(subject(rows()[0]), 'ArrowDown');
    assert.equal(focus.active, subject(rows()[1]));
    assert.equal(heading(), 'Commit b');
    assert.equal(subject(rows()[1]).scrolledIntoView, true);
    assert.equal(sent.length, 0);
    key(subject(rows()[1]), 'ArrowDown');
    assert.equal(focus.active, subject(rows()[1]));
    key(subject(rows()[1]), 'ArrowUp');
    assert.equal(focus.active, subject(rows()[0]));
    assert.equal(heading(), 'Commit a');
    key(subject(rows()[0]), 'ArrowDown', { metaKey: true });
    assert.equal(JSON.stringify(sent.at(-1)), JSON.stringify({ type: 'rebaseReorder', fromIndex: 1, toIndex: 0, reorderId: 1 }));
    assert.equal(rows()[1].dataset.hash, state.lines[1].hash);
    view.applyHostMessage({ type: 'rebaseState', state: { ...state, lines: [...state.lines].reverse(), reorderId: 1 } });
    assert.equal(focus.active, subject(rows()[1]));
    assert.equal(subject(rows()[1]).scrolledIntoView, true);
    key(subject(rows()[1]), 'ArrowUp', { metaKey: true });
    assert.equal(JSON.stringify(sent.at(-1)), JSON.stringify({ type: 'rebaseReorder', fromIndex: 0, toIndex: 1, reorderId: 2 }));
    const dropdown = select(rows()[1]);
    dropdown.focus();
    key(dropdown, 'ArrowUp', { metaKey: true });
    assert.equal(JSON.stringify(sent.at(-1)), JSON.stringify({ type: 'rebaseReorder', fromIndex: 0, toIndex: 1, reorderId: 3 }));
    const count = sent.length;
    key(dropdown, 'ArrowDown');
    assert.equal(sent.length, count);
  });

  it('marks dropped commits, keeps them selectable, and clears the marking when restored', () => {
    const { sent, view, state, rows, select, heading } = createView();
    choose(select(rows()[0]), 'drop');
    assert.equal(rows()[0].classList.contains('rebase-dropped'), true);
    assert.equal(rows()[0].getAttribute('aria-description'), 'Dropped commit; excluded from rebase');
    assert.equal(rows()[0].getAttribute('aria-selected'), 'true');
    assert.equal(heading(), 'Commit a');
    assert.equal(sent.at(-1)?.type, 'rebaseSetCommand');
    view.applyHostMessage({ type: 'rebaseState', state });
    assert.equal(rows()[0].classList.contains('rebase-dropped'), true);
    choose(select(rows()[0]), 'pick');
    assert.equal(rows()[0].classList.contains('rebase-dropped'), false);
    assert.equal(rows()[0].hasAttribute('aria-description'), false);
  });

  it('renders newest-first and connects squash/fixup downward across dropped commits and chains', () => {
    const { sent, view, state, rows, select, subject } = createView();
    state.lines = [
      { hash: 'oldest', subject: 'Oldest', command: 'pick' },
      { hash: 'middle', subject: 'Middle', command: 'fixup' },
      { hash: 'dropped', subject: 'Dropped', command: 'drop' },
      { hash: 'newest', subject: 'Newest', command: 'squash' },
    ];
    view.applyHostMessage({ type: 'rebaseState', state });
    assert.deepEqual(rows().map((row) => row.dataset.hash), ['newest', 'dropped', 'middle', 'oldest']);
    assert.deepEqual(state.lines.map((line) => line.hash), ['oldest', 'middle', 'dropped', 'newest']);
    assert.equal(rows()[0].dataset.foldTarget, 'oldest');
    assert.equal(rows()[2].dataset.foldTarget, 'oldest');
    const connector = (index: number) => rows()[index].querySelector('.rebase-fold-connector') as El;
    assert.equal(connector(0).classList.contains('outgoing'), true);
    assert.equal(connector(0).classList.contains('incoming'), false);
    assert.equal(connector(0).classList.contains('source'), true);
    assert.equal(connector(1).classList.contains('incoming'), true);
    assert.equal(connector(1).classList.contains('outgoing'), true);
    assert.equal(connector(1).classList.contains('target'), false);
    assert.equal(rows()[1].classList.contains('rebase-dropped'), true);
    assert.equal(connector(2).classList.contains('target'), false);
    assert.equal(connector(2).classList.contains('source'), true);
    assert.equal(rows()[2].classList.contains('rebase-fixup'), true);
    assert.equal(rows()[0].classList.contains('rebase-fixup'), false);
    assert.equal(connector(2).classList.contains('outgoing'), true);
    assert.equal(connector(3).classList.contains('target'), true);
    assert.equal(connector(3).classList.contains('outgoing'), false);
    assert.equal(rows().filter((row) => row.querySelector('.rebase-fold-connector.target')).length, 1);
    const count = sent.length;
    key(subject(rows()[3]), 's');
    key(subject(rows()[3]), 'f');
    assert.equal(sent.length, count);
    assert.ok(optionsOf(select(rows()[3]))
      .filter((node) => node.value === 'squash' || node.value === 'fixup').every((node) => node.disabled));
    choose(select(rows()[0]), 'pick');
    assert.equal(rows()[0].dataset.foldTarget, undefined);
    assert.equal(connector(1).classList.contains('incoming'), false);
    assert.equal(rows()[2].dataset.foldTarget, 'oldest');
    fire(rows()[0], 'dragstart');
    fire(rows()[3], 'drop');
    assert.equal(JSON.stringify(sent.at(-1)), JSON.stringify({ type: 'rebaseReorder', fromIndex: 3, toIndex: 0, reorderId: 1 }));
  });

  it('previews selected commits, retains selection across updates, and preserves rebase actions', () => {
    const { root, sent, view, state, find, rows, select, subject, heading } = createView();
    assert.equal(find('rebase-current-branch').textContent, 'Rebase: topic');
    assert.equal(heading(), 'Commit a');
    assert.equal(find('rebase-list').querySelector('input'), null);
    key(subject(rows()[1]), 'Enter');
    assert.equal(heading(), 'Commit b');
    click(rows()[0], { ctrlKey: true });
    assert.ok(rows().every((row) => row.getAttribute('aria-selected') === 'true'));
    click(rows()[1], { shiftKey: true });
    assert.ok(rows().every((row) => row.getAttribute('aria-selected') === 'true'));
    assert.equal(find('commit-author-name').textContent, 'Author b');
    assert.equal(find('commit-author-email').textContent, 'b@example.test');
    view.applyHostMessage({ type: 'rebaseState', state });
    assert.equal(heading(), 'Commit b');
    const row = rows()[1];
    choose(select(row), 'drop');
    assert.equal(sent.at(-1)?.type, 'rebaseSetCommand');
    choose(select(rows()[1]), 'reword');
    assert.equal(sent.at(-1)?.type, 'rebaseEditMessage');
    assert.equal((find('rebase-message-editor') as HTMLDialogElement).open, true);
    fire(find('rebase-message-editor'), 'cancel');
    fire(rows()[1], 'dragstart');
    fire(rows()[0], 'drop');
    assert.equal(sent.at(-1)?.type, 'rebaseReorder');
    assert.equal(root.querySelector('details'), null);
    assert.equal(root.textContent!.includes('Rebase options'), false);
    assert.equal(root.textContent!.includes('Upstream') || root.textContent!.includes('Autosquash fixups'), false);
    view.applyHostMessage({ type: 'rebaseState', state: { ...state, lines: [], commits: [] } });
    assert.equal(heading(), 'No commits to rebase');
  });

  it('lists only the actions in the dropdown, with short labels and their descriptions; reordering is by drag or keyboard', () => {
    const { sent, view, state, rows, select } = createView();
    const actions = () => rows().map(select);
    const options = optionsOf(actions()[0]);
    assert.deepEqual([...options.map((node) => node.value)], ['pick', 'edit', 'reword', 'squash', 'fixup', 'drop']);
    assert.deepEqual([...options.map((node) => node.label)], ['Pick', 'Edit', 'Reword', 'Squash', 'Fixup', 'Drop']);
    assert.equal(options[2].description, 'Edit the commit message (R)');
    assert.equal(options[4].description, 'Meld into previous commit and discard message (F)');
    assert.equal(actions()[0].getAttribute('title'), 'Use commit (P)');
    const press = (target: El, key: string) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey: true, bubbles: true, cancelable: true }));
    press(actions()[0], 'ArrowUp');
    assert.equal(sent.length, 0, 'the top commit cannot move up');
    actions()[1].focus();
    press(actions()[1], 'ArrowUp');
    assert.equal(JSON.stringify(sent.at(-1)), JSON.stringify({ type: 'rebaseReorder', fromIndex: 0, toIndex: 1, reorderId: 1 }));
    view.applyHostMessage({ type: 'rebaseState', state: { ...state, lines: [...state.lines].reverse(), reorderId: 1 } });
    assert.equal(focus.active, actions()[0]);
    assert.equal((focus.active as El).value, 'pick');
    press(actions()[0], 'ArrowDown');
    assert.equal(JSON.stringify(sent.at(-1)), JSON.stringify({ type: 'rebaseReorder', fromIndex: 1, toIndex: 0, reorderId: 2 }));
  });

  it('hides empty status banners but shows real warnings, errors, and progress', () => {
    const { view, state, find } = createView();
    for (const name of ['rebase-progress', 'rebase-warning', 'rebase-error']) {
      assert.equal(find(name).classList.contains('hidden'), true);
      assert.equal(find(name).children[0].textContent, '');
    }
    view.applyHostMessage({ type: 'rebaseState', state: { ...state, riskyCount: 2 } });
    assert.equal(find('rebase-warning').classList.contains('hidden'), false);
    assert.match(find('rebase-warning').children[0].textContent!, /2 commit/);
    view.applyHostMessage({ type: 'rebaseError', message: 'Rebase failed' });
    assert.equal(find('rebase-error').classList.contains('hidden'), false);
    assert.equal(find('rebase-error').children[0].textContent, 'Rebase failed');
    view.applyHostMessage({ type: 'rebaseState', state: {
      ...state, sequencer: { ...state.sequencer, active: true, end: 2, summary: 'Rebasing 1/2' },
    } });
    assert.equal(find('rebase-progress').classList.contains('hidden'), false);
    assert.equal(find('rebase-progress').children[0].textContent, 'Rebasing 1/2');
    assert.equal(find('rebase-warning').classList.contains('hidden'), true);
    assert.equal(find('rebase-error').classList.contains('hidden'), true);
    view.applyHostMessage({ type: 'rebaseState', state });
    assert.equal(find('rebase-progress').classList.contains('hidden'), true);
  });

  it('shows Continue, Skip and Abort as one button group while a rebase runs, and Rebase otherwise', () => {
    const { view, state, find } = createView();
    const group = () => find('rebase-progress-actions');
    assert.equal(group().localName, 'vscode-button-group');
    assert.equal(group().classList.contains('hidden'), true);
    assert.deepEqual([...group().children].map((button) => button.textContent!.trim()), ['Continue', 'Skip', 'Abort']);
    view.applyHostMessage({ type: 'rebaseState', state: { ...state, sequencer: { ...state.sequencer, active: true } } });
    assert.equal(group().classList.contains('hidden'), false);
  });

  it('supports focused-row shortcuts, retains focus, and leaves editing and modified keys alone', () => {
    const { sent, view, state, find, rows, subject } = createView();
    const subjects = () => rows().map(subject);
    let current = subjects()[0];
    current.focus();
    for (const [name, command] of [['p', 'pick'], ['e', 'edit'], ['S', 'squash'], ['f', 'fixup'], ['d', 'drop']] as const) {
      key(current, name);
      assert.equal(JSON.stringify(sent.at(-1)), JSON.stringify({ type: 'rebaseSetCommand', hash: state.lines[1].hash, command }));
    }
    view.applyHostMessage({ type: 'rebaseState', state });
    current = subjects()[0];
    assert.equal(focus.active, current);
    key(subjects()[1], 'ArrowUp', { metaKey: true });
    assert.equal(JSON.stringify(sent.at(-1)), JSON.stringify({ type: 'rebaseReorder', fromIndex: 0, toIndex: 1, reorderId: 1 }));
    key(subjects()[0], 'ArrowDown', { ctrlKey: true });
    assert.equal(JSON.stringify(sent.at(-1)), JSON.stringify({ type: 'rebaseReorder', fromIndex: 1, toIndex: 0, reorderId: 2 }));
    current = subjects()[0];
    const count = sent.length;
    key(current, 'ArrowUp', { ctrlKey: true });
    key(current, 'd', { ctrlKey: true });
    key(current, 'e', { altKey: true });
    const inner = document.createElement('a');
    current.append(inner);
    key(inner, 'd');
    inner.remove();
    assert.equal(sent.length, count);
    key(current, 'r');
    assert.equal((find('rebase-message-editor') as HTMLDialogElement).open, true);
    const editingCount = sent.length;
    key(find('rebase-message'), 'd');
    assert.equal(sent.length, editingCount);
    assert.equal(state.lines[1].command, 'drop');
    fire(find('rebase-message-editor'), 'cancel');
    view.applyHostMessage({ type: 'rebaseState', state: {
      ...state, sequencer: { ...state.sequencer, active: true },
    } });
    const inProgressCount = sent.length;
    key(subjects()[0], 'd');
    key(subjects()[0], 'ArrowDown', { metaKey: true });
    assert.equal(sent.length, inProgressCount);
    const moves = rows().flatMap((row) => optionsOf(row.querySelector('vscode-single-select')!))
      .filter((option) => option.value.startsWith('move'));
    assert.ok(moves.every((option) => option.disabled));
  });

  it('loads the full message before editing, preserves drafts across state updates, and saves only on OK', () => {
    const { root, sent, view, state, rows, subject } = createView();
    key(subject(rows()[0]), 'r');
    const dialog = root.querySelector('.rebase-message-editor') as HTMLDialogElement;
    const editorOf = () => [...dialog.querySelectorAll('.rebase-message')] as El[];
    const ok = () => [...dialog.querySelectorAll('vscode-button')].find((button) => button.textContent!.trim() === 'OK') as El;
    assert.equal(editorOf()[0].hasAttribute('disabled'), true);
    assert.equal(ok().hasAttribute('disabled'), true);
    assert.equal(state.lines[1].command, 'pick');
    state.lines[1].message = 'Original subject\n\nOriginal body\nSecond paragraph';
    view.applyHostMessage({ type: 'rebaseState', state });
    assert.equal(editorOf()[0].value, 'Original subject');
    assert.equal(editorOf()[1].value, 'Original body\nSecond paragraph');
    assert.equal(focus.active, editorOf()[0]);
    assert.equal(editorOf()[0].hasAttribute('disabled'), false);
    typeInto(editorOf()[0], ' ');
    assert.equal(ok().hasAttribute('disabled'), true);
    click(ok());
    assert.equal(state.lines[1].command, 'pick');
    typeInto(editorOf()[0], 'Updated subject');
    typeInto(editorOf()[1], 'Updated body\n\nMore details');
    view.applyHostMessage({ type: 'rebaseState', state });
    assert.equal(editorOf()[0].value, 'Updated subject');
    assert.equal(editorOf()[1].value, 'Updated body\n\nMore details');
    assert.equal(sent.length, 1);
    key(dialog, 'Enter', { ctrlKey: true });
    assert.equal(dialog.open, false);
    assert.equal(state.lines[1].message, 'Updated subject\n\nUpdated body\n\nMore details');
    assert.equal(state.lines[1].command, 'reword');
    assert.equal(sent.at(-2)?.type, 'rebaseSetMessage');
    assert.equal(sent.at(-1)?.type, 'rebaseSetCommand');
    assert.equal((focus.active as Element | null)?.className, 'rebase-subject');
    assert.ok(root.querySelector('dialog'));
  });

  it('cancels without changing the action or saved message and can reopen an existing reword', () => {
    const { root, sent, view, state, find, rows, subject } = createView();
    state.lines[1].command = 'reword';
    state.lines[1].message = 'Saved subject\n\nSaved body';
    view.applyHostMessage({ type: 'rebaseState', state });
    const open = () => key(subject(rows()[0]), 'r');
    open();
    const dialog = root.querySelector('.rebase-message-editor') as HTMLDialogElement;
    const editorOf = () => [...dialog.querySelectorAll('.rebase-message')] as El[];
    typeInto(editorOf()[0], 'Discard this');
    typeInto(editorOf()[1], 'Discard body');
    click([...dialog.querySelectorAll('vscode-button')].find((button) => button.textContent!.trim() === 'Cancel')!);
    assert.equal(dialog.open, false);
    assert.equal(sent.length, 0);
    assert.equal(state.lines[1].message, 'Saved subject\n\nSaved body');
    open();
    assert.equal(editorOf()[0].value, 'Saved subject');
    assert.equal(editorOf()[1].value, 'Saved body');
    key(dialog, 'Escape');
    assert.equal(dialog.open, false);
    assert.equal(state.lines[1].command, 'reword');
    open();
    view.applyHostMessage({ type: 'rebaseError', message: 'Cannot load message' });
    assert.equal(dialog.open, false);
    assert.equal(find('rebase-error').classList.contains('hidden'), false);
    open();
    view.applyHostMessage({ type: 'rebaseClose' });
    assert.equal(dialog.open, false);
  });
});
