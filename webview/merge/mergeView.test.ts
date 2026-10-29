import { strict as assert } from 'node:assert';
import { before, beforeEach, describe, it } from 'node:test';

import type { MergeHostMessage, MergeWebviewMessage } from '../../src/shared/conflicts/mergeProtocol';
import { installDom, resetDom } from '../testing/dom';

type El = HTMLElement & Record<string, any>;
let mountMergeView: typeof import('./mergeView').mountMergeView;

before(async () => {
  installDom();
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element & { scrolled?: boolean }) { this.scrolled = true; };
  ({ mountMergeView } = await import('./mergeView'));
});
beforeEach(resetDom);

const TEXT = [
  'one',
  '<<<<<<< HEAD',
  'current a',
  '=======',
  'incoming a',
  'incoming b',
  '>>>>>>> topic',
  'two',
  '<<<<<<< HEAD',
  'current c',
  '=======',
  'incoming c',
  '>>>>>>> topic',
  'three',
  '',
].join('\n');

const init = (text = TEXT): MergeHostMessage => ({
  type: 'mergeInit',
  path: 'src/app.ts',
  text,
  incoming: { label: 'topic', subject: 'Add the topic', author: 'Ada', date: 1761060000 },
  current: { label: 'main', subject: 'Change main', author: 'Grace', date: 1761750000 },
});

function mount(text?: string) {
  const root = document.createElement('div');
  document.body.append(root);
  const posted: MergeWebviewMessage[] = [];
  // No highlighting: the code is shown as it is.
  const view = mountMergeView(root, (message) => posted.push(message), async (_path, lines) => lines.map((line) => line.text));
  view.applyHostMessage(init(text));
  const all = (selector: string) => [...root.querySelectorAll(selector)] as El[];
  const one = (selector: string) => root.querySelector(selector) as El;
  const pick = (conflict: number, side: 'incoming' | 'current') => {
    const cell = one(`.merge-pane-${side} .merge-cell[data-conflict="${conflict}"][data-first]`);
    cell.dispatchEvent(new Event('mouseover', { bubbles: true }));
    (one(`.merge-pane-${side} .merge-cell[data-conflict="${conflict}"][data-first] .merge-pick`)).click();
  };
  const result = () => (one('.merge-editor-input').value as string).replace(/\n$/, '').split('\n');
  const type = (text: string) => {
    const input = one('.merge-editor-input');
    input.value = text;
    input.dispatchEvent(new Event('input'));
  };
  return { root, posted, view, all, one, pick, result, type };
}

describe('merge view', () => {
  it('shows both sides, with the branch and commit of each, the conflicts open, and Resolve not available', () => {
    const { all, one, result } = mount();
    assert.deepEqual(all('.merge-side').map((side) => side.querySelector('.merge-side-branch')!.textContent!.trim()), ['topic', 'main']);
    assert.equal(one('.merge-side-incoming .merge-side-commit').textContent, 'Add the topic');
    assert.match(one('.merge-side-incoming .merge-side-date').textContent!, /^\d+ \w+ 2025 at \d\d:\d\d$/);
    assert.equal(one('.merge-count').textContent, '0/2');
    assert.equal(one('.merge-footer vscode-button:last-child').hasAttribute('disabled'), true);
    // The two panes line up: the taller side of a conflict decides its height, the other side is padded.
    assert.equal(all('.merge-pane-incoming .merge-cell').length, 6);
    assert.equal(all('.merge-pane-current .merge-cell').length, 6);
    assert.equal(all('.merge-panes .commit-diff-empty').length, 1);
    assert.equal(result().filter((line) => line === '<<<<<<<').length, 2, 'the open conflicts are in the result as Git wrote them');
  });

  it('takes a side per conflict, shows it in the result, and lets it be taken back', () => {
    const { pick, result, one } = mount();
    pick(0, 'incoming');
    assert.equal(one('.merge-pane-incoming .merge-cell[data-conflict="0"][data-first] .merge-pick').textContent!.trim(), 'Remove left');
    assert.equal(one('.merge-count').textContent, '1/2');
    assert.deepEqual(result().slice(0, 5), ['one', 'incoming a', 'incoming b', 'two', '<<<<<<<']);
    pick(0, 'incoming');
    assert.equal(one('.merge-count').textContent, '0/2');
    assert.equal(result().filter((line) => line === '<<<<<<<').length, 2);
  });

  it('writes the result once every conflict has a side, the left first when both are taken', () => {
    const { pick, one, posted } = mount();
    pick(0, 'incoming');
    pick(0, 'current');
    assert.equal(one('.merge-footer vscode-button:last-child').hasAttribute('disabled'), true, 'one conflict is still open');
    pick(1, 'current');
    assert.equal(one('.merge-count').textContent, '2/2');
    assert.match(one('.merge-count').className, /merge-count-done/);
    const resolve = one('.merge-footer vscode-button:last-child');
    assert.equal(resolve.hasAttribute('disabled'), false);
    resolve.click();
    assert.deepEqual(posted.at(-1), {
      type: 'mergeResolve', path: 'src/app.ts', text: 'one\nincoming a\nincoming b\ncurrent a\ntwo\ncurrent c\nthree\n',
    });
  });

  it('takes a whole side from the box over its pane, and clears it again', () => {
    const { one, result } = mount();
    const left = one('.merge-side-incoming vscode-checkbox');
    left.checked = true;
    left.dispatchEvent(new Event('change'));
    assert.equal(one('.merge-count').textContent, '2/2');
    assert.deepEqual(result(), ['one', 'incoming a', 'incoming b', 'two', 'incoming c', 'three']);
    assert.equal(one('.merge-side-incoming vscode-checkbox').checked, true);
    assert.equal(one('.merge-side-current vscode-checkbox').checked, false);
    left.checked = false;
    left.dispatchEvent(new Event('change'));
    assert.equal(result().filter((line) => line === '<<<<<<<').length, 2);
  });

  it('moves between conflicts, around the ends', () => {
    const { one, all } = mount();
    const [previous, next] = all('.merge-nav vscode-toolbar-button');
    assert.equal(one('.merge-pane-incoming .merge-active').dataset.conflict, '0');
    next.click();
    assert.equal(one('.merge-pane-incoming .merge-active').dataset.conflict, '1');
    next.click();
    assert.equal(one('.merge-pane-incoming .merge-active').dataset.conflict, '0', 'wraps to the first');
    previous.click();
    assert.equal(one('.merge-pane-incoming .merge-active').dataset.conflict, '1', 'wraps to the last');
  });

  it('lets the result be edited by hand, and writes what was typed once no conflict is open', () => {
    const { pick, one, type, posted, result } = mount();
    pick(0, 'incoming');
    pick(1, 'current');
    type('one\nedited by hand\ntwo\ncurrent c\nthree\n');
    assert.equal(one('.merge-count').textContent, '2/2');
    assert.deepEqual(result(), ['one', 'edited by hand', 'two', 'current c', 'three']);
    one('.merge-footer vscode-button:last-child').click();
    assert.deepEqual(posted.at(-1), { type: 'mergeResolve', path: 'src/app.ts', text: 'one\nedited by hand\ntwo\ncurrent c\nthree\n' });
  });

  it('keeps Resolve off while the typed text still has conflict markers, and starts over from a new choice', () => {
    const { pick, one, type, result } = mount();
    type('one\n<<<<<<<\na\n=======\nb\n>>>>>>>\n');
    assert.equal(one('.merge-count').textContent, '1/2');
    assert.equal(one('.merge-footer vscode-button:last-child').hasAttribute('disabled'), true);
    pick(0, 'current');
    assert.equal(result().includes('edited'), false);
    assert.equal(result().includes('current a'), true, 'a choice replaces what was typed');
  });

  it('takes single lines from the numbers, marks them, and puts only them in the result', () => {
    const { all, one, result } = mount();
    const numbers = (side: string) => all(`.merge-pane-${side} .merge-cell[data-conflict="0"] .merge-line-pick`);
    assert.equal(numbers('incoming').length, 2);
    numbers('incoming')[1].click();
    assert.equal(one('.merge-count').textContent, '1/2');
    assert.deepEqual(result().slice(0, 3), ['one', 'incoming b', 'two']);
    assert.equal(numbers('incoming')[1].getAttribute('aria-pressed'), 'true');
    assert.match(numbers('incoming')[1].className, /merge-line-taken/);
    assert.doesNotMatch(numbers('incoming')[0].className, /merge-line-taken/);
    assert.equal(all('.merge-editor-line.merge-from-incoming').length, 1, 'the taken line is marked in the result');
    numbers('current')[0].click();
    assert.deepEqual(result().slice(0, 3), ['one', 'incoming b', 'current a']);
    assert.equal(one('.merge-pane-current .merge-cell[data-conflict="0"][data-first] .merge-pick').textContent!.trim(), 'Remove right');
    numbers('incoming')[1].click();
    numbers('current')[0].click();
    assert.equal(one('.merge-count').textContent, '0/2', 'giving every line back leaves the conflict open');
  });

  it('shows the buttons of a conflict only while it is hovered or focused', () => {
    const { all, one } = mount();
    const shown = () => all('.merge-cell.merge-hover').map((cell) => cell.dataset.conflict);
    assert.deepEqual(shown(), []);
    one('.merge-pane-incoming .merge-cell[data-conflict="1"]').dispatchEvent(new Event('mouseover', { bubbles: true }));
    assert.deepEqual([...new Set(shown())], ['1'], 'both sides of the conflict show them');
    one('.merge-pane-incoming').dispatchEvent(new Event('mouseleave'));
    assert.deepEqual(shown(), []);
  });

  it('says a side is empty where a conflict has nothing from it, and still lets it be taken', () => {
    const { all, one, pick } = mount('a\n<<<<<<< HEAD\n=======\nincoming\n>>>>>>> t\nb\n');
    assert.equal(one('.merge-pane-current .merge-empty').textContent, '--- empty ---');
    assert.equal(all('.merge-pane-incoming .merge-empty').length, 0);
    assert.equal(all('.merge-pane-current .merge-line-pick').length, 0, 'there are no lines to pick on that side');
    pick(0, 'current');
    assert.equal(one('.merge-count').textContent, '1/1', 'taking the empty side resolves the conflict');
  });

  it('takes single lines from the right side when it has more lines than the left', () => {
    const { all, one, result } = mount('a\n<<<<<<< HEAD\nr1\nr2\nr3\n=======\nl1\n>>>>>>> t\nb\n');
    const numbers = all('.merge-pane-current .merge-cell[data-conflict="0"] .merge-line-pick');
    assert.equal(numbers.length, 3);
    numbers[2].click();
    assert.deepEqual(result(), ['a', 'r3', 'b']);
    numbers[0].click();
    assert.deepEqual(result(), ['a', 'r1', 'r3', 'b']);
    assert.equal(one('.merge-count').textContent, '1/1');
  });

  it('puts the result below the two sides, or between them from the toggle', () => {
    const { one, all } = mount();
    assert.equal(one('.merge-split .merge-panes') !== null, true, 'the sides are over the result by default, apart by a bar to drag');
    assert.equal(one('.merge-split [slot="end"] .merge-result') !== null, true);
    const toggle = one('.merge-footer vscode-toolbar-button');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    assert.deepEqual(all('.merge-columns > *').map((part) => part.className.split(' ')[0]), ['merge-pane', 'merge-result', 'merge-pane']);
    assert.equal(all('.merge-split').length, 0);
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    assert.equal(all('.merge-columns').length, 0);
  });

  it('colors the lines only one side has like a diff: deleted on the left, added on the right', () => {
    const { all } = mount('<<<<<<< HEAD\nsame\nnew\n=======\nold\nsame\n>>>>>>> t\n');
    assert.deepEqual(all('.merge-pane-incoming .commit-diff-del code').map((code) => code.textContent), ['old']);
    assert.deepEqual(all('.merge-pane-current .commit-diff-add code').map((code) => code.textContent), ['new']);
  });

  it('puts the counter and the arrows in the modal header and the file in its title when it has them', () => {
    const root = document.createElement('div');
    const extras = document.createElement('span');
    const title = document.createElement('h2');
    document.body.append(root, extras, title);
    const view = mountMergeView(root, () => undefined, async (_path, lines) => lines.map((line) => line.text), { extras, title });
    view.applyHostMessage(init());
    assert.equal(title.textContent, 'Merge: src/app.ts');
    assert.equal(extras.querySelector('.merge-count')?.textContent, '0/2');
    assert.equal(root.querySelector('.merge-nav') === null, true, 'the view does not draw them twice');
    assert.equal(root.querySelector('.merge-path') === null, true);
  });

  it('marks the lines of a conflict still open in the result', () => {
    const { all, pick } = mount();
    assert.equal(all('.merge-editor-line.merge-from-open').length, 11, 'both conflicts, with their markers');
    pick(0, 'incoming');
    assert.equal(all('.merge-editor-line.merge-from-open').length, 5);
  });

  it('cancels, and hands the file to the editor', () => {
    const { all, posted } = mount();
    const [open, cancel] = all('.merge-footer vscode-button');
    cancel.click();
    open.click();
    assert.deepEqual(posted.slice(-2), [
      { type: 'mergeCancel', path: 'src/app.ts' },
      { type: 'mergeOpenInEditor', path: 'src/app.ts' },
    ]);
  });

  it('says so when the file has no conflict markers, and offers the editor', () => {
    const { one, posted } = mount('just text\n');
    assert.match(one('.merge-message').textContent!, /no conflict markers/);
    one('.merge-message vscode-button').click();
    assert.equal(posted.at(-1)?.type, 'mergeOpenInEditor');
  });

  it('shows what went wrong when the file could not be written, and lets the person try again', () => {
    const { pick, one, view, all } = mount();
    pick(0, 'current');
    pick(1, 'current');
    one('.merge-footer vscode-button:last-child').click();
    assert.equal(one('.merge-footer vscode-button:last-child').hasAttribute('disabled'), true, 'busy while it is written');
    view.applyHostMessage({ type: 'mergeError', message: 'Could not write the file.' });
    assert.equal(one('.merge-error').textContent!.trim().startsWith('Could not write the file.'), true);
    assert.equal(all('.merge-panes').length, 0, 'the message takes the place of the merge');
  });
});
