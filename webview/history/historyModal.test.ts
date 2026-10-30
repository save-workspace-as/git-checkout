import { strict as assert } from 'node:assert';
import { before, beforeEach, describe, it } from 'node:test';
import type { GraphCommitDto } from '../../src/shared/graph/graphProtocol';
import { DEFAULT_COMMIT_DIFF_VIEW } from '../../src/shared/diff/commitDiffPresentation';
import type { WebviewMessage } from '../protocol';
import { focus, installDom, resetDom } from '../testing/dom';

type El = HTMLElement & Record<string, any>;
let mountHistoryModal: typeof import('./historyModal').mountHistoryModal;

before(async () => {
  installDom();
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  Element.prototype.scrollIntoView = function scrollIntoView() {};
  ({ mountHistoryModal } = await import('./historyModal'));
});
beforeEach(resetDom);

const commit = (letter: string, subject = `Change ${letter}`): GraphCommitDto => ({
  sha: letter.repeat(40), parents: [], subject, author: `Author ${letter}`, authorEmail: `${letter}@example.test`,
  authorDate: 1000, refs: [],
});

function mount() {
  const shell = document.createElement('div');
  document.body.append(shell);
  const sent: WebviewMessage[] = [];
  const modal = mountHistoryModal(shell, (message) => sent.push(message));
  const q = (selector: string) => shell.querySelector(selector) as El;
  const rows = () => [...shell.querySelectorAll('.history-row')] as El[];
  modal.applyHostMessage({ type: 'pathHistoryOpen', scope: 'file', path: 'src/app.ts', title: 'History', canFollow: true });
  return { shell, sent, modal, q, rows };
}

const types = (sent: WebviewMessage[]) => sent.map((message) => message.type);

describe('History modal', () => {
  it('opens with the path, a title for what it shows, and the options that apply', () => {
    const { modal, q, shell } = mount();
    assert.equal(q('.history-path').textContent, 'src/app.ts');
    assert.equal(q('.modal-title').textContent, 'History');
    assert.equal(q('.modal-overlay').classList.contains('hidden'), false);
    assert.equal(shell.querySelector('.history-option.hidden'), null, 'following renames applies to a file');
    assert.equal(q('.history-reset').classList.contains('hidden'), false);
    assert.equal(q('.history-reset').hasAttribute('disabled'), true, 'nothing is selected yet');
    modal.applyHostMessage({ type: 'pathHistoryOpen', scope: 'directory', path: 'src', title: 'Folder History', canFollow: false });
    assert.equal(q('.modal-title').textContent, 'Folder History');
    assert.equal(q('.history-option').classList.contains('hidden'), true);
    assert.equal(q('.history-reset').classList.contains('hidden'), true);
  });

  it('lists the commits, selects the first, and asks for its change', () => {
    const { modal, rows, sent, q } = mount();
    modal.applyHostMessage({ type: 'pathHistoryMeta', summary: '2 commits', github: null, follow: true, includeMerges: false });
    modal.applyHostMessage({ type: 'pathHistoryPage', append: false, page: { commits: [commit('a'), commit('b')], hasMore: false } } as never);
    assert.equal(q('.history-status').textContent, '2 commits');
    assert.deepEqual(rows().map((row) => row.querySelector('.history-subject')!.textContent), ['Change a', 'Change b']);
    assert.deepEqual(rows().map((row) => row.getAttribute('aria-selected')), ['true', 'false']);
    assert.deepEqual(sent.at(-1), { type: 'pathHistorySelect', sha: 'a'.repeat(40) });
    assert.equal(q('.history-reset').hasAttribute('disabled'), false);
    assert.equal(q('.history-options vscode-checkbox').checked, true);
  });

  it('moves the selection with the arrow keys, Home and End', () => {
    const { modal, rows, sent, q } = mount();
    modal.applyHostMessage({ type: 'pathHistoryPage', append: false, page: { commits: [commit('a'), commit('b'), commit('c')], hasMore: false } } as never);
    const press = (name: string) => q('.history-list').dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
    press('ArrowDown');
    assert.equal(rows()[1].getAttribute('aria-selected'), 'true');
    press('End');
    assert.equal(rows()[2].getAttribute('aria-selected'), 'true');
    press('ArrowDown');
    assert.equal(rows()[2].getAttribute('aria-selected'), 'true');
    press('Home');
    assert.equal(rows()[0].getAttribute('aria-selected'), 'true');
    assert.deepEqual(sent.filter((message) => message.type === 'pathHistorySelect').map((message) => (message as { sha: string }).sha[0]),
      ['a', 'b', 'c', 'a']);
  });

  it('selects a clicked commit and opens it in the editor without selecting it', () => {
    const { modal, rows, sent } = mount();
    modal.applyHostMessage({ type: 'pathHistoryPage', append: false, page: { commits: [commit('a'), commit('b')], hasMore: false } } as never);
    rows()[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert.equal(rows()[1].getAttribute('aria-selected'), 'true');
    sent.length = 0;
    rows()[0].querySelector('.history-open')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert.deepEqual(sent, [{ type: 'pathHistoryOpenInEditor', sha: 'a'.repeat(40) }]);
    assert.equal(rows()[1].getAttribute('aria-selected'), 'true');
  });

  it('asks for more when the list is scrolled near its end, once', () => {
    const { modal, q, sent } = mount();
    modal.applyHostMessage({ type: 'pathHistoryPage', append: false, page: { commits: [commit('a')], hasMore: true } } as never);
    const list = q('.history-list');
    Object.defineProperty(list, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(list, 'clientHeight', { value: 400, configurable: true });
    list.scrollTop = 500;
    list.dispatchEvent(new Event('scroll'));
    list.dispatchEvent(new Event('scroll'));
    assert.equal(types(sent).filter((type) => type === 'pathHistoryLoadMore').length, 1);
    modal.applyHostMessage({ type: 'pathHistoryPage', append: true, page: { commits: [commit('a'), commit('b')], hasMore: false } } as never);
    assert.equal(q('.history-list').children.length >= 2, true);
  });

  it('toggles the options on the host, resets the file, and closes with the close button', () => {
    const { modal, q, sent } = mount();
    modal.applyHostMessage({ type: 'pathHistoryPage', append: false, page: { commits: [commit('a')], hasMore: false } } as never);
    const [follow, merges] = [...q('.history-options').querySelectorAll('vscode-checkbox')] as El[];
    follow.dispatchEvent(new Event('change'));
    merges.dispatchEvent(new Event('change'));
    q('.history-reset').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert.deepEqual(sent.slice(-3), [
      { type: 'pathHistoryToggle', option: 'follow' }, { type: 'pathHistoryToggle', option: 'merges' },
      { type: 'pathHistoryReset' },
    ]);
    q('.modal-close').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert.equal(sent.at(-1)?.type, 'pathHistoryClose');
    assert.equal(q('.modal-overlay').classList.contains('hidden'), true);
  });

  it('shows the same toolbar as the diff views and forwards its options', () => {
    const { q, sent } = mount();
    const button = [...q('.diff-toolbar').children].find((child) => child.getAttribute('title') === 'Wrap Long Lines') as El;
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert.deepEqual(sent.at(-1), { type: 'pathHistoryViewOption', option: 'wrap' });
    void focus;
  });

  it('shows the list again when it is opened a second time', () => {
    const { modal, rows } = mount();
    modal.applyHostMessage({ type: 'pathHistoryPage', append: false, page: { commits: [commit('a')], hasMore: false } } as never);
    modal.applyHostMessage({ type: 'pathHistoryClose' });
    modal.applyHostMessage({ type: 'pathHistoryOpen', scope: 'file', path: 'src/other.ts', title: 'History', canFollow: false });
    assert.equal(rows().length, 0);
    modal.applyHostMessage({ type: 'pathHistoryPage', append: false, page: { commits: [commit('b')], hasMore: false } } as never);
    assert.deepEqual(rows().map((row) => row.dataset.sha![0]), ['b']);
  });
});

describe('Blame modal opened at a commit', () => {
  function open(select: string) {
    const shell = document.createElement('div');
    document.body.append(shell);
    const sent: WebviewMessage[] = [];
    const modal = mountHistoryModal(shell, (message) => sent.push(message), { blame: true });
    modal.applyHostMessage({ type: 'pathHistoryOpen', scope: 'file', path: 'a.ts', title: 'Blame', canFollow: true, mode: 'blame', select });
    return { modal, sent };
  }
  const page = (letters: string[], hasMore: boolean, append: boolean) =>
    ({ type: 'pathHistoryPage', append, page: { commits: letters.map((letter) => commit(letter)), hasMore } }) as never;

  it('selects that commit instead of the newest', () => {
    const { modal, sent } = open('b'.repeat(40));
    modal.applyHostMessage(page(['a', 'b', 'c'], false, false));
    assert.deepEqual(sent.at(-1), { type: 'pathHistorySelect', sha: 'b'.repeat(40) });
    assert.equal(sent.filter((message) => message.type === 'pathHistorySelect').length, 1, 'the newest is never selected on the way');
  });

  it('waits for the pages that have it, and selects it when it arrives', () => {
    const { modal, sent } = open('d'.repeat(40));
    modal.applyHostMessage(page(['a', 'b'], true, false));
    assert.equal(sent.some((message) => message.type === 'pathHistorySelect'), false);
    modal.applyHostMessage(page(['c', 'd'], false, true));
    assert.deepEqual(sent.at(-1), { type: 'pathHistorySelect', sha: 'd'.repeat(40) });
  });

  it('falls back to the newest when the history does not have it', () => {
    const { modal, sent } = open('z'.repeat(40));
    modal.applyHostMessage(page(['a', 'b'], true, false));
    modal.applyHostMessage(page(['c'], false, true));
    assert.deepEqual(sent.at(-1), { type: 'pathHistorySelect', sha: 'a'.repeat(40) });
  });
});

describe('Blame modal', () => {
  function mountBlame() {
    const shell = document.createElement('div');
    document.body.append(shell);
    const sent: WebviewMessage[] = [];
    const modal = mountHistoryModal(shell, (message) => sent.push(message), { blame: true });
    const q = (selector: string) => shell.querySelector(selector) as El;
    modal.applyHostMessage({ type: 'pathHistoryOpen', scope: 'file', path: 'src/app.ts', title: 'Blame', canFollow: true, mode: 'blame' });
    modal.applyHostMessage({ type: 'pathHistoryPage', append: false, page: { commits: [commit('a'), commit('b'), commit('c')], hasMore: false } } as never);
    return { shell, sent, modal, q };
  }
  const diff = [
    { kind: 'hunk', text: '@@ -1,2 +1,2 @@' },
    { kind: 'context', text: 'keep', line: 1 },
    { kind: 'del', text: 'old', line: 2 },
    { kind: 'add', text: 'new', line: 2 },
  ] as const;
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);

  it('steps through the commits with arrows and a dropdown instead of a list', () => {
    const { q, shell } = mountBlame();
    assert.equal(q('.modal-title').textContent, 'Blame');
    assert.equal(shell.querySelector('.history-list') === null, true);
    assert.equal(shell.querySelector('.diff-toolbar') === null, false, 'the diff toolbar of History');
    assert.equal(shell.querySelector('.history-reset') === null, true);
    assert.deepEqual([...shell.querySelectorAll('vscode-option')].map((option) => option.getAttribute('value')), [A, B, 'c'.repeat(40)]);
    assert.match(shell.querySelector('vscode-option')!.textContent ?? '', /^aaaaaaa \| Change a \(/);
  });

  it('moves to an older or a newer commit with the arrows, and stops at the ends', () => {
    const { shell, sent } = mountBlame();
    const [older, newer] = [...shell.querySelectorAll('.blame-steps vscode-button')] as El[];
    assert.equal(newer.hasAttribute('disabled'), true, 'the newest commit has nothing newer');
    older.click();
    assert.deepEqual(sent.at(-1), { type: 'pathHistorySelect', sha: B });
    older.click();
    assert.deepEqual(sent.at(-1), { type: 'pathHistorySelect', sha: 'c'.repeat(40) });
    assert.equal(older.hasAttribute('disabled'), true, 'the oldest commit has nothing older');
    newer.click();
    assert.deepEqual(sent.at(-1), { type: 'pathHistorySelect', sha: B });
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
  const blameOf = (commits: Record<string, unknown>, shas: string[]) =>
    ({ type: 'pathHistoryBlame', sha: A, shas, commits }) as never;
  const people = {
    [B]: { author: 'Bea', authorMail: 'b@example.test', authorTime: 1000, summary: 'Earlier change' },
    [A]: { author: 'Ada', authorMail: 'a@example.test', authorTime: 2000, summary: 'This change' },
  };

  it('shows the diff in the same viewer as History, with the commit that last changed each line before it', async () => {
    const { modal, shell, q } = mountBlame();
    modal.applyHostMessage({ type: 'pathHistoryDiff', sha: A, binary: false, lines: [...diff] } as never);
    await settle();
    assert.equal(shell.querySelectorAll('.commit-diff-line:not(.commit-diff-hunk)').length, 3);
    assert.equal(shell.querySelector('.commit-diff-lead') === null, true, 'nothing before the blame arrives');
    modal.applyHostMessage(blameOf(people, ['', B, A, A]));
    assert.deepEqual([...shell.querySelectorAll('.blame-hash')].map((button) => button.textContent), ['bbbbbbb', 'aaaaaaa'], 'a run of the same commit shows its details once');
    assert.equal(shell.querySelectorAll('.commit-diff-lead').length, 3, 'every line has the cell, so the columns line up');
    assert.equal(q('.commit-diff-del code').textContent, 'old');
    assert.equal(q('.commit-diff-add code').textContent, 'new');
  });

  it('has the diff toolbar of History, without a side-by-side button', () => {
    const { shell } = mountBlame();
    const titles = [...shell.querySelectorAll('.diff-toolbar vscode-toolbar-button')].map((button) => button.getAttribute('title'));
    assert.ok(titles.includes('Wrap Long Lines'));
    assert.ok(!titles.includes('Side by Side View'));
  });

  it('keeps one column even when the diff options ask for side by side', async () => {
    const { modal, shell } = mountBlame();
    modal.setViewOptions({ ...DEFAULT_COMMIT_DIFF_VIEW, sideBySide: true });
    modal.applyHostMessage({ type: 'pathHistoryDiff', sha: A, binary: false, lines: [...diff] } as never);
    await settle();
    assert.equal(shell.querySelector('.commit-diff-pair') === null, true);
  });

  it('selects the commit when its hash is clicked', async () => {
    const { modal, shell, sent } = mountBlame();
    modal.applyHostMessage({ type: 'pathHistoryDiff', sha: A, binary: false, lines: [...diff] } as never);
    await settle();
    modal.applyHostMessage(blameOf({ [B]: people[B] }, ['', B, '', '']));
    (shell.querySelector('.blame-hash') as HTMLElement).click();
    assert.deepEqual(sent.at(-1), { type: 'pathHistorySelect', sha: B });
  });

  it('offers to blame before this change on the lines the selected commit changed, and asks the host for that line', async () => {
    const { modal, shell, sent } = mountBlame();
    modal.applyHostMessage({ type: 'pathHistoryDiff', sha: A, binary: false, lines: [...diff] } as never);
    await settle();
    modal.applyHostMessage(blameOf(people, ['', B, A, A]));
    const buttons = [...shell.querySelectorAll('.blame-before')] as El[];
    assert.equal(buttons.length, 1, 'only the run of lines this commit changed has it, not the line another commit wrote');
    assert.equal(buttons[0].getAttribute('title'), 'Blame before this change');
    buttons[0].click();
    assert.deepEqual(sent.at(-1), { type: 'pathHistoryBlameBefore', sha: A, line: 2 });
  });

  it('selects the commit the host asks for', () => {
    const { modal, sent } = mountBlame();
    modal.applyHostMessage({ type: 'pathHistorySelectCommit', sha: 'c'.repeat(40) });
    assert.deepEqual(sent.at(-1), { type: 'pathHistorySelect', sha: 'c'.repeat(40) });
  });

  it('opens the selected commit of the file in an editor from the header', () => {
    const { shell, sent } = mountBlame();
    (shell.querySelector('vscode-toolbar-button') as HTMLElement).click();
    assert.deepEqual(sent.at(-1), { type: 'pathHistoryOpenInEditor', sha: A });
  });

  it('says why there is nothing to show', () => {
    const { modal, shell } = mountBlame();
    modal.applyHostMessage({ type: 'pathHistoryDiff', sha: A, binary: false, lines: [], error: 'boom' } as never);
    assert.match(shell.querySelector('.code-viewer-error')?.textContent ?? '', /boom/);
  });

});
