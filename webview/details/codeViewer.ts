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
  let ready = false;
  let message: { text: string; error: boolean } | undefined;

  // The view draws into a host of its own. Other views clear the container with plain DOM calls, which would
  // leave a template drawing into nodes that are gone, so a host that was removed is replaced.
  let host = document.createElement('div');
  host.className = 'code-viewer-content';
  function hostElement(): HTMLElement {
    if (host.parentElement !== container) {
      host = document.createElement('div');
      host.className = 'code-viewer-content';
      container.replaceChildren(host);
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

  function lineRow(index: number): TemplateResult {
    const line = lines[index];
    return html`
      <div class="commit-diff-line commit-diff-${line.kind}" data-diff-nav=${lineMarks(line) ? '1' : nothing}>
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
            <vscode-button type="button" secondary @click=${action.run}>${action.label}</vscode-button>`)}</vscode-button-group>
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
          [row.left, row.right].map((index) => index === undefined
            ? html`<div class="commit-diff-line commit-diff-empty"></div>` : lineRow(index))}</div>`;
      if (box) { box.rows.push(item); } else { out.push(item); }
    }
    flush();
    return out;
  }

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
