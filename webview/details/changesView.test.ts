import { strict as assert } from 'node:assert';
import { before, beforeEach, describe, it } from 'node:test';
import { installDom, resetDom } from '../testing/dom';

type El = HTMLElement & Record<string, any>;
interface View {
  applyHostMessage(message: unknown): void;
}
let mountChangesView: typeof import('./changesView').mountChangesView;

before(async () => {
  installDom();
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  ({ mountChangesView } = await import('./changesView'));
});
beforeEach(resetDom);

function mount(): { root: HTMLElement; posted: Record<string, unknown>[]; view: View; q: (selector: string) => El } {
  const root = document.createElement('div');
  document.body.append(root);
  const posted: Record<string, unknown>[] = [];
  const view = mountChangesView(root, (message) => posted.push(message as unknown as Record<string, unknown>));
  return { root, posted, view, q: (selector) => root.querySelector(selector) as El };
}

const entries = [
  { path: 'a.ts', group: 'unstaged', status: 'modified' },
  { path: 'new.txt', group: 'untracked', status: 'untracked' },
  { path: 'b.ts', group: 'staged', status: 'added' },
];

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
const snapshot = (list: unknown[]) => ({ type: 'workingCopySnapshot', snapshot: { entries: list, flags: [] } });
const typeInto = (element: El, value: string) => {
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('Changes tab diff and commit form', () => {
  it('picks the first change when there is none selected, and keeps the selected one', () => {
    const { posted, view } = mount();
    view.applyHostMessage(snapshot(entries));
    assert.deepEqual(plain(posted.at(-1)), { type: 'changesSelect', path: 'a.ts', side: 'unstaged' });
    view.applyHostMessage({ type: 'changesSelection', selection: { path: 'b.ts', side: 'staged' } });
    view.applyHostMessage(snapshot(entries));
    assert.deepEqual(plain(posted.at(-1)), { type: 'changesSelect', path: 'b.ts', side: 'staged' });
  });

  it('follows a staged file between the lists, and clears when no changes are left', () => {
    const { posted, view } = mount();
    view.applyHostMessage(snapshot(entries));
    view.applyHostMessage({ type: 'changesSelection', selection: { path: 'a.ts', side: 'unstaged' } });
    view.applyHostMessage(snapshot([{ path: 'a.ts', group: 'staged', status: 'modified' }]));
    assert.deepEqual(plain(posted.at(-1)), { type: 'changesSelect', path: 'a.ts', side: 'staged' });
    view.applyHostMessage(snapshot([]));
    assert.deepEqual(plain(posted.at(-1)), { type: 'changesSelect', path: '', side: 'unstaged' });
  });

  it('commits the subject and description once something is staged, then clears', () => {
    const { posted, view, q } = mount();
    assert.equal(q('.changes-commit').hasAttribute('disabled'), true);
    view.applyHostMessage(snapshot(entries));
    typeInto(q('.changes-subject'), ' Add things ');
    assert.equal(q('.changes-commit').hasAttribute('disabled'), false);
    typeInto(q('.changes-description'), 'Because');
    q('.changes-commit').click();
    assert.deepEqual(plain(posted.at(-1)), {
      type: 'changesCommit', subject: 'Add things', description: 'Because', amend: false,
    });
    view.applyHostMessage({ type: 'changesCommitted' });
    assert.equal(q('.changes-subject').value, '');
    assert.equal(q('.changes-description').value, '');
  });

  it('presses Commit with Cmd or Ctrl+Enter, and Commit and Push with Shift', () => {
    const { posted, view, q } = mount();
    view.applyHostMessage(snapshot(entries));
    typeInto(q('.changes-subject'), 'Ship it');
    const press = (target: Element, init: KeyboardEventInit = {}) =>
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }));
    press(q('.changes-description'));
    assert.notEqual(posted.at(-1)?.type, 'changesCommit');
    press(q('.changes-subject'), { metaKey: true });
    assert.deepEqual(plain(posted.at(-1)), {
      type: 'changesCommit', subject: 'Ship it', description: '', amend: false,
    });
    press(q('.changes-description'), { ctrlKey: true, shiftKey: true });
    assert.equal((posted.at(-1) as { push?: boolean }).push, true);
    press(q('.changes-subject'), { metaKey: true, altKey: true });
    assert.equal((posted.at(-1) as { push?: boolean }).push, true);
  });

  it('leaves Cmd+Enter alone while Commit is disabled', () => {
    const { posted, q } = mount();
    typeInto(q('.changes-subject'), 'Nothing staged');
    q('.changes-subject').dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', bubbles: true, cancelable: true, metaKey: true,
    }));
    assert.equal(posted.some((message) => message.type === 'changesCommit'), false);
  });

  it('commits and pushes from the keyboard shortcut, and focuses the subject from the other', () => {
    const { posted, view, q } = mount();
    view.applyHostMessage(snapshot(entries));
    typeInto(q('.changes-subject'), 'Ship it');
    view.applyHostMessage({ type: 'changesShortcut', action: 'commitAndPush' });
    assert.deepEqual(plain(posted.at(-1)), {
      type: 'changesCommit', subject: 'Ship it', description: '', amend: false, push: true,
    });
    view.applyHostMessage({ type: 'changesShortcut', action: 'focusCommit' });
    assert.equal(document.activeElement, q('.changes-subject'));
  });

  it('fills the form from the last commit when amending', () => {
    const { posted, view, q } = mount();
    const amend = q('.changes-amend');
    amend.checked = true;
    amend.dispatchEvent(new Event('change', { bubbles: true }));
    assert.equal(posted.at(-1)?.type, 'changesAmend');
    view.applyHostMessage({ type: 'changesAmendMessage', subject: 'Old subject', description: 'Old body' });
    assert.equal(q('.changes-subject').value, 'Old subject');
    assert.equal(q('.changes-description').value, 'Old body');
  });

  it('puts Stage and Discard over each hunk of an unstaged change, and Unstage over a staged one', () => {
    const { root, posted, view } = mount();
    view.applyHostMessage(snapshot([
      { path: 'a.ts', group: 'unstaged', status: 'modified' },
      { path: 'b.ts', group: 'staged', status: 'modified' },
    ]));
    const diffLines = [
      { kind: 'hunk', text: '@@ -1 +1 @@' },
      { kind: 'del', text: 'x', line: 1 },
      { kind: 'add', text: 'y', line: 1 },
    ];
    view.applyHostMessage({ type: 'changesSelection', selection: { path: 'a.ts', side: 'unstaged' } });
    view.applyHostMessage({ type: 'changesDiff', path: 'a.ts', side: 'unstaged', binary: false, lines: diffLines });
    const buttons = () => [...root.querySelector('.commit-diff-hunk-actions')!.children] as El[];
    assert.deepEqual(buttons().map((button) => button.textContent), ['Stage', 'Discard Changes…']);
    buttons()[0].click();
    assert.match(String((posted.at(-1) as { patch: string }).patch), /^diff --git a\/a\.ts b\/a\.ts\n--- a\/a\.ts\n\+\+\+ b\/a\.ts\n@@ -1 \+1 @@\n-x\n\+y\n$/);
    assert.deepEqual({ ...(posted.at(-1) as object), patch: '' }, { type: 'changesHunk', path: 'a.ts', op: 'stage', patch: '' });
    buttons()[1].click();
    assert.equal((posted.at(-1) as { op: string }).op, 'discard');

    view.applyHostMessage({ type: 'changesSelection', selection: { path: 'b.ts', side: 'staged' } });
    view.applyHostMessage({ type: 'changesDiff', path: 'b.ts', side: 'staged', binary: false, lines: diffLines });
    assert.deepEqual(buttons().map((button) => button.textContent), ['Unstage']);
  });

  it('stages or discards a whole untracked file from its single hunk', () => {
    const { root, posted, view } = mount();
    view.applyHostMessage(snapshot([{ path: 'new.txt', group: 'untracked', status: 'untracked' }]));
    view.applyHostMessage({ type: 'changesSelection', selection: { path: 'new.txt', side: 'unstaged' } });
    view.applyHostMessage({
      type: 'changesDiff', path: 'new.txt', side: 'unstaged', binary: false,
      lines: [{ kind: 'hunk', text: '@@ -0,0 +1,1 @@' }, { kind: 'add', text: 'x', line: 1 }],
    });
    (root.querySelector('.commit-diff-hunk-actions')!.children[0] as El).click();
    assert.deepEqual(plain(posted.at(-1)), { type: 'changesActions', actions: [{ op: 'stage', path: 'new.txt' }] });
  });

  it('writes a commit message with AI only when something is staged, and fills the form', () => {
    const { posted, view, q } = mount();
    const generate = () => q('.changes-generate');
    assert.equal(generate().hasAttribute('disabled'), true);
    view.applyHostMessage(snapshot(entries));
    assert.equal(generate().hasAttribute('disabled'), false);
    generate().click();
    assert.equal(posted.at(-1)?.type, 'changesGenerateMessage');
    view.applyHostMessage({ type: 'changesGenerating', busy: true });
    assert.equal(generate().hasAttribute('disabled'), true);
    view.applyHostMessage({ type: 'changesGeneratedMessage', subject: 'feat: add it', description: 'Because.' });
    view.applyHostMessage({ type: 'changesGenerating', busy: false });
    assert.equal(q('.changes-subject').value, 'feat: add it');
    assert.equal(q('.changes-description').value, 'Because.');
    assert.equal(generate().hasAttribute('disabled'), false);
    assert.equal(q('.changes-commit').hasAttribute('disabled'), false);
  });
});
