import type { CommitDiffLineDto } from '../../src/shared/history/commitDetailsProtocol';
import {
  DEFAULT_COMMIT_DIFF_VIEW,
  presentDiffLines,
  type CommitDiffViewOptions,
} from '../../src/shared/diff/commitDiffPresentation';
import type { EditorTokenColors } from '../../src/shared/diff/editorTokenColors';
import { escapeHtml, markInvisibles } from '../../src/shared/diff/invisibleChars';
import * as l10n from '@vscode/l10n';
import { highlightDiffLines } from './highlightLine';
import { html, nothing, render, type TemplateResult } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';

/** A button over a hunk, such as Stage. */
export interface HunkAction {
  label: string;
  run(): void;
}

/** What a viewer does with the lines a person selected, such as Stage: the buttons shown beside the selection. */
export type SelectionActions = (positions: number[]) => HunkAction[];

/** Lines drawn before the rest waits behind a button, so a huge diff does not freeze the panel. */
export const MAX_RENDERED_LINES = 5000;

export function mountCodeViewer(
  container: HTMLElement,
  highlight = highlightDiffLines,
) {
  container.classList.add('code-viewer');
  container.tabIndex = 0;
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', l10n.t('Read-only code preview'));
  let generation = 0;
  let lines: CommitDiffLineDto[] = [];
  /** Every line of the file or diff; `lines` is the part drawn. */
  let allLines: CommitDiffLineDto[] = [];
  let shownPath = '';
  let highlighted: string[] = [];
  let mode: 'file' | 'diff' = 'file';
  let options = { ...DEFAULT_COMMIT_DIFF_VIEW };
  let navIndex = -1;
  /** Buttons to show over each hunk of a diff, by the hunk's position; none when unset. */
  let hunkActions: ((hunkIndex: number) => HunkAction[]) | undefined;
  /** What to show beside each line of a diff, such as who last changed it; nothing when unset. */
  let lineLead: ((index: number) => TemplateResult | undefined) | undefined;
  /** The buttons for selected change lines, by their position in the diff; none when unset. */
  let selectionActions: SelectionActions | undefined;
  let listeningForSelection = false;
  /** The change line a click on a line number started from, for extending with Shift. */
  let anchorRow: HTMLElement | undefined;
  let ready = false;
  let message: { text: string; error: boolean } | undefined;

  // The view draws into a host of its own. Other views clear the container with plain DOM calls, which would
  // leave a template drawing into nodes that are gone, so a host that was removed is replaced.
  let host = document.createElement('div');
  host.className = 'code-viewer-content';
  // The buttons beside a selection live next to the diff, so drawing the diff again does not touch them.
  const selectionPopup = document.createElement('div');
  selectionPopup.className = 'code-viewer-selection-actions';
  selectionPopup.hidden = true;
  // A press on a button must not clear the selection it acts on.
  selectionPopup.addEventListener('mousedown', (event) => event.preventDefault());
  function hostElement(): HTMLElement {
    if (host.parentElement !== container) {
      host = document.createElement('div');
      host.className = 'code-viewer-content';
      container.replaceChildren(host, selectionPopup);
    }
    return host;
  }

  const lineMarks = (line: CommitDiffLineDto): boolean => mode === 'diff' && (line.kind === 'add' || line.kind === 'del');

  function codeOf(index: number): unknown {
    const line = lines[index];
    if (options.showInvisibles) {
      return unsafeHTML(markInvisibles(highlighted[index] ?? escapeHtml(line.text)));
    }
    return highlighted[index] === undefined ? line.text : unsafeHTML(highlighted[index]);
  }

  /** `side` is set for a line in a side-by-side pair, so a selection can stay on one side. */
  function lineRow(index: number, side?: 'left' | 'right'): TemplateResult {
    const line = lines[index];
    return html`
      <div class="commit-diff-line commit-diff-${line.kind}" data-diff-nav=${lineMarks(line) ? '1' : nothing}
        data-line=${selectionActions && lineMarks(line) ? String(index) : nothing} data-side=${side ?? nothing}>
        ${lineLead ? html`<span class="commit-diff-lead">${lineLead(index) ?? nothing}</span>` : nothing}<span class="commit-diff-lineno" aria-hidden="true">${line.line === undefined ? '' : String(line.line)}</span>${mode === 'diff' && options.changeMarks !== false
          ? html`<span class="commit-diff-gutter" aria-hidden="true">${line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}</span>`
          : nothing}<code>${codeOf(index)}</code>
      </div>`;
  }

  /** A diff: hunk headers, and with actions each hunk in a box that outlines it on hover and carries its buttons. */
  function diffRows(): TemplateResult[] {
    const out: TemplateResult[] = [];
    let box: { header: TemplateResult; actions: HunkAction[]; rows: TemplateResult[] } | undefined;
    const flush = (): void => {
      if (!box) { return; }
      const { header, actions, rows } = box;
      out.push(html`
        <div class="commit-diff-hunk-box">
          <vscode-button-group class="commit-diff-hunk-actions">${actions.map((action) => html`
            <vscode-button type="button" @click=${action.run}>${action.label}</vscode-button>`)}</vscode-button-group>
          ${header}${rows}
        </div>`);
      box = undefined;
    };
    let hunkIndex = -1;
    for (const row of presentDiffLines(lines, options)) {
      if (row.type === 'hunk') {
        flush();
        hunkIndex += 1;
        const header = html`<div class="commit-diff-line commit-diff-hunk" data-diff-nav="1">${row.text}</div>`;
        const actions = hunkActions?.(hunkIndex) ?? [];
        if (actions.length > 0) { box = { header, actions, rows: [] }; } else { out.push(header); }
        continue;
      }
      const item = row.type === 'inline' ? lineRow(row.index) : html`
        <div class="commit-diff-pair" data-diff-nav=${[row.left, row.right].some((index) => index !== undefined && lineMarks(lines[index])) ? '1' : nothing}>${
          [row.left, row.right].map((index, position) => index === undefined
            ? html`<div class="commit-diff-line commit-diff-empty"></div>` : lineRow(index, position === 0 ? 'left' : 'right'))}</div>`;
      if (box) { box.rows.push(item); } else { out.push(item); }
    }
    flush();
    return out;
  }

  /** Whether the selection only touches the edge of the row, as when a triple click ends where the next row starts. */
  function touchesEdgeOnly(row: HTMLElement, range: Range): boolean {
    const atEdge = (node: Node, offset: number, sibling: 'previousSibling' | 'nextSibling'): boolean => {
      if (!row.contains(node)) { return false; }
      const edge = sibling === 'previousSibling' ? 0 : (node.nodeType === Node.TEXT_NODE ? (node.textContent ?? '').length : node.childNodes.length);
      if (offset !== edge) { return false; }
      for (let current: Node | null = node; current && current !== row; current = current.parentNode) {
        if (current[sibling]) { return false; }
      }
      return true;
    };
    return atEdge(range.endContainer, range.endOffset, 'previousSibling') || atEdge(range.startContainer, range.startOffset, 'nextSibling');
  }

  /** The positions of the change lines the person has selected, and the first of their rows. */
  function selectedChanges(): { positions: number[]; first: HTMLElement } | undefined {
    const selection = document.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) { return undefined; }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) { return undefined; }
    const side = container.dataset.selectSide;
    const positions: number[] = [];
    let first: HTMLElement | undefined;
    for (const row of container.querySelectorAll<HTMLElement>('[data-line]')) {
      if ((side && row.dataset.side && row.dataset.side !== side) || !range.intersectsNode(row) || touchesEdgeOnly(row, range)) { continue; }
      positions.push(Number(row.dataset.line));
      first ??= row;
    }
    return first ? { positions, first } : undefined;
  }

  function hideSelectionActions(): void {
    render(nothing, selectionPopup);
    selectionPopup.hidden = true;
    container.classList.remove('has-selection-actions');
  }

  /**
   * Shows the buttons at the top right of the selection, where a hunk's buttons are, and takes the hunk buttons
   * away so one Stage or Unstage shows at a time. Hides them when no change line is selected.
   */
  function updateSelectionActions(): void {
    const selected = selectionActions && ready && mode === 'diff' ? selectedChanges() : undefined;
    const actions = selected ? selectionActions?.(selected.positions) ?? [] : [];
    if (!selected || actions.length === 0) {
      hideSelectionActions();
      return;
    }
    if (selectionPopup.parentElement !== container) { container.append(selectionPopup); }
    const box = container.getBoundingClientRect();
    render(html`
      <vscode-button-group role="group" aria-label=${l10n.t('Selected lines')}>${actions.map((action) => html`
        <vscode-button type="button" @click=${() => { action.run(); document.getSelection()?.removeAllRanges(); hideSelectionActions(); }}>${action.label}</vscode-button>`)}
      </vscode-button-group>`, selectionPopup);
    selectionPopup.hidden = false;
    container.classList.add('has-selection-actions');
    const rowTop = selected.first.getBoundingClientRect().top - box.top + container.scrollTop;
    selectionPopup.style.top = `${Math.max(rowTop, container.scrollTop) + 2}px`;
    selectionPopup.style.left = `${container.scrollLeft + container.clientWidth - 12}px`;
  }

  /** A click on a line number selects the line; with Shift it extends the selection from the line clicked before. */
  function selectRowFromGutter(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : undefined;
    const row = target?.closest<HTMLElement>('.commit-diff-lineno, .commit-diff-gutter')?.closest<HTMLElement>('.commit-diff-line[data-line]');
    const selection = document.getSelection();
    if (!row || !selection || !selectionActions) { return; }
    if (row.dataset.side) { container.dataset.selectSide = row.dataset.side; } else { delete container.dataset.selectSide; }
    const from = event.shiftKey && anchorRow && container.contains(anchorRow) ? anchorRow : row;
    anchorRow = from;
    const [first, last] = from.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_PRECEDING ? [row, from] : [from, row];
    selection.setBaseAndExtent(first, 0, last, last.childNodes.length);
    updateSelectionActions();
  }

  // In a side-by-side diff a drag stays on the side it started on, so one side's lines can be picked alone.
  container.addEventListener('mousedown', (event) => {
    const line = event.target instanceof Element ? event.target.closest<HTMLElement>('.commit-diff-pair > .commit-diff-line') : null;
    if (line?.dataset.side) { container.dataset.selectSide = line.dataset.side; } else { delete container.dataset.selectSide; }
  });
  container.addEventListener('click', selectRowFromGutter);

  function template(): TemplateResult {
    if (message || !ready) {
      return html`<div class=${message?.error ? 'code-viewer-error' : 'code-viewer-message'}
        role=${message?.error ? 'alert' : nothing}>${message?.text ?? ''}</div>`;
    }
    const hidden = allLines.length - lines.length;
    return html`${mode === 'file' ? lines.map((_, index) => lineRow(index)) : diffRows()}${hidden > 0 ? html`
      <div class="commit-diff-truncated">
        <span>${l10n.t('Showing the first {0} of {1} lines.', lines.length, allLines.length)}</span>
        <vscode-button type="button" secondary @click=${() => { void show(shownPath, allLines, mode, true, Number.POSITIVE_INFINITY); }}
        >${l10n.t('Show all')}</vscode-button>
      </div>` : nothing}`;
  }

  function paint(): void {
    container.classList.toggle('wrap-lines', options.wrapLines);
    if (ready && mode === 'diff') {
      container.classList.toggle('show-invisibles', options.showInvisibles);
    }
    if (!ready && !message) { return; }
    if (ready) { navIndex = -1; }
    render(template(), hostElement());
    // The selection survives drawing again, so its buttons are shown again for it.
    updateSelectionActions();
  }

  function showMessage(text: string, error = false): void {
    generation++;
    ready = false;
    lines = [];
    highlighted = [];
    message = { text, error };
    paint();
  }

  async function show(
    path: string,
    next: CommitDiffLineDto[],
    nextMode: 'file' | 'diff',
    keepScroll = false,
    limit = MAX_RENDERED_LINES,
  ): Promise<void> {
    const current = ++generation;
    mode = nextMode;
    allLines = next;
    shownPath = path;
    lines = next.length > limit ? next.slice(0, limit) : next;
    highlighted = [];
    ready = true;
    message = undefined;
    const top = keepScroll ? container.scrollTop : 0;
    const left = keepScroll ? container.scrollLeft : 0;
    container.scrollTop = top;
    container.scrollLeft = left;
    container.setAttribute('aria-label', l10n.t('Read-only code preview: {0}', path));
    paint();
    if (options.syntaxHighlighting === false) {
      return;
    }
    try {
      const result = await highlight(path, lines);
      if (current !== generation) {
        return;
      }
      highlighted = result;
      const scrolledTop = container.scrollTop;
      const scrolledLeft = container.scrollLeft;
      paint();
      container.scrollTop = scrolledTop;
      container.scrollLeft = scrolledLeft;
    } catch (error) {
      if (current === generation) {
        showMessage(l10n.t('Syntax highlighting failed: {0}', error instanceof Error ? error.message : String(error)), true);
      }
    }
  }

  return {
    showFile(path: string, text: string): Promise<void> {
      if (text.includes('\0')) {
        showMessage(l10n.t('Binary file.'));
        return Promise.resolve();
      }
      if (text.length === 0) {
        showMessage(l10n.t('Empty file.'));
        return Promise.resolve();
      }
      const source = text.replace(/\r\n/g, '\n').split('\n');
      if (source[source.length - 1] === '') {
        source.pop();
      }
      return show(path, source.map((text, index) => ({
        kind: 'context', text, line: index + 1,
      })), 'file');
    },
    showDiff(path: string, next: CommitDiffLineDto[], binary: boolean, keepScroll = false): Promise<void> {
      if (binary || next.length === 0) {
        showMessage(binary ? l10n.t('Binary file.') : l10n.t('No textual changes.'));
        return Promise.resolve();
      }
      return show(path, next, 'diff', keepScroll);
    },
    showMessage,
    /** Puts a cell before the line number of every line, drawn by `next` from the line's position in the diff. */
    setLineLead(next: ((index: number) => TemplateResult | undefined) | undefined): void {
      lineLead = next;
      paint();
    },
    setHunkActions(next: ((hunkIndex: number) => HunkAction[]) | undefined): void {
      hunkActions = next;
    },
    /** Buttons for the change lines a person selects in a diff (by drag, or by clicking line numbers); none when unset. */
    setSelectionActions(next: SelectionActions | undefined): void {
      selectionActions = next;
      if (next && !listeningForSelection) {
        listeningForSelection = true;
        document.addEventListener('selectionchange', updateSelectionActions);
      }
      if (!next) { hideSelectionActions(); }
    },
    /** Shows or hides the selection's buttons for the current selection. */
    refreshSelectionActions: updateSelectionActions,
    setOptions(next: CommitDiffViewOptions): void {
      const rehighlight = (options.syntaxHighlighting !== false) !== (next.syntaxHighlighting !== false);
      options = { ...next };
      if (rehighlight && ready) {
        // Turning highlighting on or off draws the code again, keeping the place.
        void show(shownPath, allLines, mode, true, Math.max(lines.length, MAX_RENDERED_LINES));
        return;
      }
      paint();
    },
    setTokenColors(colors: EditorTokenColors): void {
      const vars: Record<string, string> = {
        foreground: colors.foreground,
        keyword: colors.keyword,
        string: colors.string,
        number: colors.number,
        comment: colors.comment,
        type: colors.type,
        function: colors.function,
        variable: colors.variable,
        'comment-style': colors.commentStyle,
      };
      for (const [name, value] of Object.entries(vars)) {
        const property = `--commit-token-${name}`;
        if (name !== 'foreground' && value.toLowerCase() === colors.foreground.toLowerCase()) {
          container.style.removeProperty(property);
        } else {
          container.style.setProperty(property, value);
        }
      }
    },
    navigate(direction: 'previous' | 'next'): void {
      const marks = Array.from(container.querySelectorAll<HTMLElement>('[data-diff-nav]'));
      if (marks.length === 0) {
        return;
      }
      navIndex = direction === 'next'
        ? Math.min(marks.length - 1, navIndex + 1)
        : Math.max(0, navIndex - 1);
      marks[navIndex]?.scrollIntoView({ block: 'center' });
    },
  };
}
