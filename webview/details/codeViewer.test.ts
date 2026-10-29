import { strict as assert } from 'node:assert';
import { afterEach, before, beforeEach, describe, it } from 'node:test';
import type { CommitDiffLineDto } from '../../src/shared/history/commitDetailsProtocol';
import { DEFAULT_COMMIT_DIFF_VIEW } from '../../src/shared/diff/commitDiffPresentation';
import { editorTokenColorsFromRules } from '../../src/shared/diff/editorTokenColors';
import { installDom, resetDom } from '../testing/dom';

type El = HTMLElement & Record<string, any>;
type Highlighter = (path: string, lines: { kind: string; text: string }[]) => Promise<string[]>;
let mountCodeViewer: typeof import('./codeViewer').mountCodeViewer;

before(async () => {
  installDom();
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element & { scrolled?: boolean }) { this.scrolled = true; };
  ({ mountCodeViewer } = await import('./codeViewer'));
});
beforeEach(resetDom);

function mount(highlight?: Highlighter) {
  const container = document.createElement('div') as El;
  document.body.append(container);
  const viewer = mountCodeViewer(container, highlight);
  const all = (selector: string) => [...container.querySelectorAll(selector)] as El[];
  return { container, viewer, all, one: (selector: string) => container.querySelector(selector) as El | null };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('shared read-only code viewer', () => {
  it('highlights full files, numbers CRLF lines, and uses a focusable read-only region', async () => {
    const { viewer, container, all } = mount();
    await viewer.showFile('app.ts', 'export const answer = 42;\r\n// comment\r\n');
    const rows = all('.commit-diff-line');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].querySelector('.commit-diff-lineno')!.textContent, '1');
    assert.equal(rows[1].querySelector('.commit-diff-lineno')!.textContent, '2');
    assert.match(all('code')[0].innerHTML, /hljs-keyword/);
    assert.match(all('code')[1].innerHTML, /hljs-comment/);
    assert.equal(container.tabIndex, 0);
    assert.equal(container.getAttribute('role'), 'region');
    assert.equal(container.querySelector('textarea'), null);
  });

  it('preserves multiline syntax scopes with balanced markup in each row', async () => {
    const { viewer, all } = mount();
    await viewer.showFile('app.ts', '/* first\nsecond\nthird */\nconst value = 1;');
    const code = all('code');
    for (const line of code.slice(0, 3)) {
      assert.match(line.innerHTML, /hljs-comment/);
      assert.equal((line.innerHTML.match(/<span\b/g) ?? []).length, (line.innerHTML.match(/<\/span>/g) ?? []).length);
    }
    assert.doesNotMatch(code[3].innerHTML, /hljs-comment/);
  });

  it('escapes unknown languages and keeps blank lines without a phantom trailing row', async () => {
    const { viewer, all } = mount();
    await viewer.showFile('unknown.extension', '<img src=x>\n\n&text\n');
    const code = all('code');
    assert.equal(code.length, 3);
    assert.equal(code[0].textContent, '<img src=x>');
    assert.equal(code[1].textContent, '');
    assert.equal(code[2].textContent, '&text');
    assert.equal(code[0].querySelector('img'), null, 'the text is not read as markup');
  });

  it('distinguishes empty files, binary diffs, loading states and errors', async () => {
    const { viewer, container, one } = mount();
    await viewer.showFile('empty.ts', '');
    assert.equal(container.textContent, 'Empty file.');
    await viewer.showDiff('image.png', [], true);
    assert.equal(container.textContent, 'Binary file.');
    await viewer.showFile('binary.dat', 'content\0binary');
    assert.equal(container.textContent, 'Binary file.');
    await viewer.showDiff('app.ts', [], false);
    assert.equal(container.textContent, 'No textual changes.');
    viewer.showMessage('Loading file...');
    assert.equal(container.textContent, 'Loading file...');
    viewer.showMessage('File not found', true);
    assert.equal(one('.code-viewer-error')?.getAttribute('role'), 'alert');
    assert.equal(container.textContent, 'File not found');
  });

  it('ignores pending highlighting after a different file or status replaces it', async () => {
    let finish: (html: string[]) => void = () => {};
    const { viewer, container, one } = mount(() => new Promise((resolve) => { finish = resolve; }));
    const pending = viewer.showFile('old.ts', 'old code');
    assert.equal(one('code')?.textContent, 'old code');
    viewer.showMessage('Loading new file...');
    finish(['old highlighted code']);
    await pending;
    assert.equal(container.textContent, 'Loading new file...');
  });

  it('surfaces highlighting failures rather than leaving stale content', async () => {
    const { viewer, container, one } = mount(async () => { throw new Error('Grammar failed'); });
    await viewer.showFile('app.ts', 'const value = 1;');
    assert.match(container.textContent!, /Syntax highlighting failed:.*Grammar failed/);
    assert.equal(one('.code-viewer-error')?.getAttribute('role'), 'alert');
  });

  it('updates and resets theme token colors on the same control', () => {
    const { viewer, container } = mount();
    const colors = editorTokenColorsFromRules([], undefined);
    viewer.setTokenColors({ ...colors, keyword: '#123456' });
    assert.equal(container.style.getPropertyValue('--commit-token-keyword'), '#123456');
    viewer.setTokenColors({ ...colors, keyword: colors.foreground });
    assert.equal(container.style.getPropertyValue('--commit-token-keyword'), '');
  });

  it('retains inline and swapped side-by-side diff rendering and navigation', async () => {
    const { viewer, all, one } = mount();
    await viewer.showDiff('app.ts', [
      { kind: 'del', text: 'const oldValue = 1;', line: 10 },
      { kind: 'add', text: 'const newValue = 2;', line: 10 },
    ], false);
    assert.equal(all('.commit-diff-del').length, 1);
    assert.equal(all('.commit-diff-add').length, 1);
    assert.match(one('code')?.innerHTML ?? '', /hljs-keyword/);
    viewer.navigate('next');
    assert.equal(one('[data-diff-nav]')!.scrolled, true);
    viewer.setOptions({ ...DEFAULT_COMMIT_DIFF_VIEW, sideBySide: true, swapped: true });
    const pair = one('.commit-diff-pair')!;
    assert.match(pair.children[0].className, /commit-diff-add/);
    assert.match(pair.children[1].className, /commit-diff-del/);
    viewer.navigate('next');
    assert.equal(pair.scrolled, true);
  });

  it('hides the change marks and skips highlighting when those options are off', async () => {
    let highlighted = 0;
    const { viewer, one } = mount(async (_path, lines) => { highlighted += 1; return lines.map((line) => line.text); });
    const lines: CommitDiffLineDto[] = [{ kind: 'add', text: 'x', line: 1 }];
    await viewer.showDiff('app.ts', lines, false);
    assert.equal(one('.commit-diff-gutter') === null, false);
    assert.equal(highlighted, 1);
    viewer.setOptions({ ...DEFAULT_COMMIT_DIFF_VIEW, changeMarks: false, syntaxHighlighting: false });
    await settle();
    assert.equal(one('.commit-diff-gutter') === null, true);
    await viewer.showDiff('app.ts', lines, false);
    assert.equal(highlighted, 1);
  });

  it('draws invisible characters in diff lines when asked', async () => {
    const { viewer, one } = mount();
    await viewer.showDiff('app.ts', [{ kind: 'context', text: 'a b', line: 1 }], false);
    assert.doesNotMatch(one('code')?.innerHTML ?? '', /commit-invisible/);
    viewer.setOptions({ ...DEFAULT_COMMIT_DIFF_VIEW, showInvisibles: true });
    assert.match(one('code')?.innerHTML ?? '', /commit-invisible">·</);
  });

  it('draws a huge diff in part and the rest on request', async () => {
    const { viewer, all, one } = mount();
    const many: CommitDiffLineDto[] = Array.from({ length: 5001 }, (_, i) => ({ kind: 'context', text: `l${i}`, line: i + 1 }));
    await viewer.showDiff('app.ts', many, false);
    assert.equal(all('code').length, 5000);
    assert.match(one('.commit-diff-truncated')?.textContent ?? '', /5000 of 5001/);
    one('.commit-diff-truncated vscode-button')!.click();
    await settle();
    assert.equal(all('code').length, 5001);
    assert.equal(one('.commit-diff-truncated'), null);
  });

  it('keeps the scroll position when the same file is re-read', async () => {
    const { viewer, container } = mount();
    const lines: CommitDiffLineDto[] = [{ kind: 'context', text: 'a', line: 1 }];
    await viewer.showDiff('app.ts', lines, false);
    container.scrollTop = 120;
    await viewer.showDiff('app.ts', lines, false, true);
    assert.equal(container.scrollTop, 120);
    await viewer.showDiff('app.ts', lines, false);
    assert.equal(container.scrollTop, 0);
  });

  it('puts each hunk in a box with its own buttons when actions are set', async () => {
    const { viewer, all } = mount();
    const ran: string[] = [];
    viewer.setHunkActions((index) => [{ label: 'Stage', run: () => ran.push(`stage ${index}`) }]);
    await viewer.showDiff('app.ts', [
      { kind: 'hunk', text: '@@ -1 +1 @@' },
      { kind: 'del', text: 'a', line: 1 },
      { kind: 'add', text: 'b', line: 1 },
      { kind: 'hunk', text: '@@ -9 +9 @@' },
      { kind: 'add', text: 'c', line: 9 },
    ], false);
    const boxes = all('.commit-diff-hunk-box');
    assert.equal(boxes.length, 2);
    assert.equal(boxes[0].querySelectorAll('code').length, 2);
    assert.equal(boxes[1].querySelectorAll('code').length, 1);
    (boxes[1].querySelector('.commit-diff-hunk-actions')!.children[0] as El).click();
    assert.deepEqual(ran, ['stage 1']);
    viewer.setHunkActions(undefined);
    await viewer.showDiff('app.ts', [{ kind: 'hunk', text: '@@ -1 +1 @@' }, { kind: 'add', text: 'x', line: 1 }], false);
    assert.equal(all('.commit-diff-hunk-box').length, 0);
  });

  describe('selecting lines of a diff', () => {
    const diff: CommitDiffLineDto[] = [
      { kind: 'hunk', text: '@@ -1,4 +1,4 @@' },
      { kind: 'context', text: 'a', line: 1 },
      { kind: 'del', text: 'b', line: 2 },
      { kind: 'add', text: 'B', line: 2 },
      { kind: 'del', text: 'c', line: 3 },
      { kind: 'add', text: 'C', line: 3 },
      { kind: 'context', text: 'd', line: 4 },
    ];
    const realGetSelection = document.getSelection;
    afterEach(() => { document.getSelection = realGetSelection; });

    /** A selection over these rows, as the browser reports it. */
    function select(container: El, rows: (El | undefined)[], extra: Record<string, unknown> = {}) {
      const range = {
        commonAncestorContainer: container,
        startContainer: container, startOffset: 0, endContainer: container, endOffset: 0,
        intersectsNode: (node: Node) => rows.includes(node as El),
        getClientRects: () => [],
        getBoundingClientRect: () => ({ top: 40, bottom: 58, left: 10, right: 120 }),
      };
      const selection = {
        isCollapsed: rows.length === 0, rangeCount: 1, getRangeAt: () => range,
        removeAllRanges: () => { selection.isCollapsed = true; rows.length = 0; },
        setBaseAndExtent: (first: El, _a: number, last: El) => {
          const all = [...container.querySelectorAll('.commit-diff-line')] as El[];
          rows.splice(0, rows.length, ...all.slice(all.indexOf(first), all.indexOf(last) + 1));
          selection.isCollapsed = false;
        },
        ...extra,
      };
      document.getSelection = () => selection as unknown as Selection;
      document.dispatchEvent(new Event('selectionchange'));
      return selection;
    }

    const viewerOf = (popup: El): El => popup.parentElement as El;

    async function mountDiff(options?: { split?: boolean }) {
      const m = mount();
      const picked: number[][] = [];
      m.viewer.setSelectionActions((positions) => [{ label: 'Stage', run: () => picked.push(positions) }]);
      if (options?.split) { m.viewer.setOptions({ ...DEFAULT_COMMIT_DIFF_VIEW, sideBySide: true }); }
      await m.viewer.showDiff('app.ts', diff, false);
      return { ...m, picked, popup: () => m.one('.code-viewer-selection-actions')! };
    }

    it('numbers only the change lines, and only when there is something to do with a selection', async () => {
      const { all } = await mountDiff();
      assert.deepEqual(all('[data-line]').map((row) => row.dataset.line), ['2', '3', '4', '5']);
      const plain = mount();
      await plain.viewer.showDiff('app.ts', diff, false);
      assert.equal(plain.all('[data-line]').length, 0);
    });

    it('shows buttons at the end of a selection and hands over the selected change lines', async () => {
      const { all, popup, picked } = await mountDiff();
      const rows = all('[data-line]');
      assert.equal(popup().hidden, true);
      select(popup().parentElement as El, [rows[0], rows[1]]);
      assert.equal(popup().hidden, false);
      assert.equal(popup().style.top, '2px', 'at the top of the first selected line, where a hunk\'s buttons sit');
      assert.match(viewerOf(popup()).className, /has-selection-actions/, 'the hunk buttons give way');
      assert.deepEqual([...popup().querySelectorAll('vscode-button')].map((button) => button.textContent!.trim()), ['Stage']);
      (popup().querySelector('vscode-button') as El).click();
      assert.deepEqual(picked, [[2, 3]]);
      assert.equal(popup().hidden, true, 'the buttons go once the selection is used');
      assert.doesNotMatch(viewerOf(popup()).className, /has-selection-actions/);
    });

    it('shows nothing for a collapsed selection or one over context lines only', async () => {
      const { container, all, popup } = await mountDiff();
      select(container, []);
      assert.equal(popup().hidden, true);
      select(container, [all('.commit-diff-context')[0]]);
      assert.equal(popup().hidden, true);
    });

    it('leaves out a row the selection only touches at its edge', async () => {
      const { container, all, popup, picked } = await mountDiff();
      const rows = all('[data-line]');
      const next = rows[1];
      // A triple click on the first change ends at the very start of the next row.
      select(container, [rows[0], next], { getRangeAt: () => ({
        commonAncestorContainer: container, startContainer: rows[0], startOffset: 0,
        endContainer: next, endOffset: 0,
        intersectsNode: (node: Node) => node === rows[0] || node === next,
        getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, bottom: 10, left: 0, right: 10 }),
      }) });
      (popup().querySelector('vscode-button') as El).click();
      assert.deepEqual(picked, [[2]]);
    });

    it('selects a line from its number, and a range with Shift', async () => {
      const { all, popup, picked } = await mountDiff();
      const rows = all('[data-line]');
      select(popup().parentElement as El, []);
      (rows[0].querySelector('.commit-diff-lineno') as El).click();
      assert.equal(popup().hidden, false);
      (rows[2].querySelector('.commit-diff-lineno') as El).dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
      (popup().querySelector('vscode-button') as El).click();
      assert.deepEqual(picked, [[2, 3, 4]]);
    });

    it('keeps a selection on the side of a side-by-side diff it started on', async () => {
      const { container, all, popup, picked } = await mountDiff({ split: true });
      const rows = all('[data-line]');
      const left = rows.filter((row) => row.dataset.side === 'left');
      const right = rows.filter((row) => row.dataset.side === 'right');
      assert.ok(left.length > 0 && right.length > 0);
      left[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      assert.equal(container.dataset.selectSide, 'left');
      select(container, rows);
      (popup().querySelector('vscode-button') as El).click();
      assert.deepEqual(picked, [left.map((row) => Number(row.dataset.line))]);
    });

    it('hides the buttons when the actions are taken away or the view shows a message', async () => {
      const { viewer, all, popup } = await mountDiff();
      select(popup().parentElement as El, [all('[data-line]')[0]]);
      assert.equal(popup().hidden, false);
      viewer.showMessage('No changes.');
      assert.equal(popup().hidden, true);
    });
  });

  it('wraps long lines only when asked', async () => {
    const { viewer, container } = mount();
    await viewer.showDiff('app.ts', [{ kind: 'context', text: 'a', line: 1 }], false);
    assert.doesNotMatch(container.className, /wrap-lines/);
    viewer.setOptions({ ...DEFAULT_COMMIT_DIFF_VIEW, wrapLines: true });
    assert.match(container.className, /wrap-lines/);
  });

  it('draws again after another view cleared its container', async () => {
    const { viewer, container, one } = mount();
    await viewer.showDiff('app.ts', [{ kind: 'context', text: 'first', line: 1 }], false);
    container.replaceChildren(document.createElement('p'));
    await viewer.showDiff('app.ts', [{ kind: 'context', text: 'second', line: 1 }], false);
    assert.equal(one('code')?.textContent, 'second');
  });
});
