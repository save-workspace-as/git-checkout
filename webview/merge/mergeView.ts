import * as l10n from '@vscode/l10n';
import { html, nothing, render, type TemplateResult } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { live } from 'lit/directives/live.js';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import {
  allHaveSide,
  conflictsOf,
  paneRows,
  parseMergeDocument,
  editableText,
  fileText,
  openConflicts,
  resultLineMap,
  resultOrigins,
  unresolved,
  withLineToggled,
  withSideTaken,
  withSide,
  type MergeChoice,
  type MergeDocument,
  type MergeSides,
  type PaneRow,
} from '../../src/shared/conflicts/mergeDocument';
import type { MergeHostMessage, MergeSideDto, MergeWebviewMessage } from '../../src/shared/conflicts/mergeProtocol';
import { ACTION_ICONS } from '../../src/shared/app/actionIcons';
import { formatDateTime } from '../../src/shared/history/commitDate';
import { escapeHtml } from '../../src/shared/diff/invisibleChars';
import { applyTokenColors } from '../details/codeViewer';
import { highlightDiffLines } from '../details/highlightLine';
import type { VscodeCheckbox } from '@vscode-elements/elements/dist/vscode-checkbox/index.js';

type Highlighter = (path: string, lines: { kind: string; text: string }[]) => Promise<string[]>;
type Side = 'incoming' | 'current';

/** The lines of a file as the panes show them. */
const linesOf = (text: string): string[] => {
  const lines = text.split(/\r?\n/);
  if (text.endsWith('\n')) { lines.pop(); }
  return lines;
};

function sidesOf(host: { ours?: string; theirs?: string }): MergeSides | undefined {
  return host.ours === undefined || host.theirs === undefined ? undefined : { ours: linesOf(host.ours), theirs: linesOf(host.theirs) };
}

const LAYOUT_KEY = 'gitCheckout.merge.layout';

/** The layout the person chose last time. Storage can be missing or blocked, and then the result goes below. */
function storedLayout(): 'below' | 'between' {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'between' ? 'between' : 'below';
  } catch {
    // A webview without storage keeps the default; there is nothing to tell the person.
    return 'below';
  }
}

interface State {
  path: string;
  incoming: MergeSideDto;
  current: MergeSideDto;
  document: MergeDocument;
  rows: PaneRow[];
  choices: MergeChoice[];
  /** The conflict the navigation buttons are on. */
  active: number;
  /** The conflict under the pointer or the focus, whose buttons show. */
  hovered: number | undefined;
  /** The result as edited by hand; unset while it follows the choices. */
  manual: string | undefined;
  /** Highlighted code by line number in each side's file, and by line in the result. */
  code: { incoming: string[]; current: string[]; result: string[] };
  busy: boolean;
  /** Where the result goes: below the two sides, or between them. */
  layout: 'below' | 'between';
  /** How much of the height the two sides take when the result is below them, in percent. */
  split: number;
}

/**
 * The Merge modal for one conflicted file: the incoming side on the left, the current side on the right, and
 * the result below. Each conflict takes one side, the other, or both; the result is written when none is open.
 */
export function mountMergeView(
  container: HTMLElement,
  postMessage: (message: MergeWebviewMessage) => void,
  highlight: Highlighter = highlightDiffLines,
  /** Where the modal keeps its own controls and title; without them the view draws them itself. */
  frame: { extras?: HTMLElement; title?: HTMLElement } = {},
): { applyHostMessage(message: MergeHostMessage): void } {
  container.classList.add('merge');
  // The bar between the sides and the result has no keyboard of its own, so Ctrl+Alt with Up or Down moves it.
  container.addEventListener('keydown', (event) => {
    if (!state || state.layout !== 'below' || !event.ctrlKey || !event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) { return; }
    event.preventDefault();
    state.split = Math.min(85, Math.max(15, state.split + (event.key === 'ArrowDown' ? 5 : -5)));
    paint();
  });
  let state: State | undefined;
  let message: { text: string; error: boolean } | undefined = { text: l10n.t('Loading the file…'), error: false };
  let generation = 0;

  const sideName = (side: Side): string => (side === 'incoming' ? l10n.t('left') : l10n.t('right'));
  const total = (): number => state?.choices.length ?? 0;
  /** The result: what the choices give, or what the person typed over it. */
  const resultOf = (): string => state!.manual ?? editableText(state!.document, state!.choices);
  const open = (): number => openConflicts(resultOf());
  const resolved = (): number => Math.max(0, total() - open());
  const done = (): boolean => total() > 0 && open() === 0;

  function codeOf(side: Side, line: number, text: string): unknown {
    const marked = state?.code[side][line - 1];
    return marked === undefined ? text : unsafeHTML(marked);
  }

  function sideCard(side: Side): TemplateResult {
    const info = state![side];
    const checked = allHaveSide(state!.choices, side);
    return html`
      <label class="merge-side merge-side-${side}">
        <vscode-checkbox .checked=${checked} ?disabled=${state!.busy}
          aria-label=${l10n.t('Take all changes from {0}', info.label)}
          @change=${(event: Event) => {
            state!.choices = withSide(state!.choices, side, (event.target as VscodeCheckbox).checked);
            changed();
          }}></vscode-checkbox>
        <span class="merge-side-text">
          <span class="merge-side-branch"><vscode-icon name=${ACTION_ICONS.branch} aria-hidden="true"></vscode-icon>${info.label}</span>
          <span class="merge-side-commit" title=${info.subject}>${info.subject}</span>
        </span>
        <span class="merge-side-date">${info.date > 0 ? formatDateTime(new Date(info.date * 1000)) : ''}</span>
      </label>`;
  }

  function toggle(conflict: number, side: Side): void {
    const taken = state!.choices[conflict][side].taken;
    state!.choices = state!.choices.map((choice, index) => (index === conflict ? withSideTaken(choice, side, !taken) : choice));
    state!.active = conflict;
    changed();
  }

  /** Takes one line of a side, or gives it back. */
  function toggleLine(conflict: number, side: Side, offset: number): void {
    state!.choices = state!.choices.map((choice, index) => (index === conflict ? withLineToggled(choice, side, offset) : choice));
    state!.active = conflict;
    changed();
  }

  /** The buttons over the first row of a conflict: take that side, or take it back. */
  function actions(conflict: number, side: Side): TemplateResult {
    const taken = state!.choices[conflict][side].taken;
    const label = taken
      ? l10n.t('Remove {0}', sideName(side))
      : l10n.t('Select {0}', sideName(side));
    return html`<vscode-button class="merge-pick" type="button" ?disabled=${state!.busy}
      @click=${() => toggle(conflict, side)}>${label}</vscode-button>`;
  }

  function cell(row: PaneRow, side: Side): TemplateResult {
    const cellOf = side === 'incoming' ? row.left : row.right;
    const conflict = row.conflict;
    const index = side === 'incoming' ? row.incomingIndex : row.currentIndex;
    const taken = conflict !== undefined && index !== undefined && state!.choices[conflict][side].lines[index] === true;
    const classes = classMap({
      'commit-diff-line': true,
      'merge-cell': true,
      [`merge-conflict-${side}`]: conflict !== undefined,
      'merge-taken': taken,
      'merge-active': conflict !== undefined && conflict === state!.active,
      'merge-hover': conflict !== undefined && conflict === state!.hovered,
      'commit-diff-empty': cellOf === undefined,
      // Lines only one side has read like a diff of the left against the right: deleted on the left, added on the right.
      'commit-diff-del': cellOf?.changed === true && side === 'incoming',
      'commit-diff-add': cellOf?.changed === true && side === 'current',
    });
    const slot = conflict !== undefined && row.first ? html`<span class="merge-pick-slot">${actions(conflict, side)}</span>` : nothing;
    return html`<div class=${classes} data-conflict=${conflict === undefined ? nothing : String(conflict)} data-first=${row.first ? '1' : nothing}>${
      cellOf ? html`${conflict === undefined || index === undefined ? html`<span class="commit-diff-lineno" aria-hidden="true">${cellOf.line}</span>` : linePick(conflict, side, index, cellOf.line, taken)}<code>${codeOf(side, cellOf.line, cellOf.text)}</code>` : html`<span class="commit-diff-lineno" aria-hidden="true"> </span><code>${
        conflict !== undefined && row.first && state!.choices[conflict][side].lines.length === 0 ? html`<span class="merge-empty">${l10n.t('--- empty ---')}</span>` : ' '}</code>`}${slot}</div>`;
  }

  /** The line number of a line in a conflict: press it to take the line or give it back; a taken line's number is filled. */
  function linePick(conflict: number, side: Side, offset: number, line: number, taken: boolean): TemplateResult {
    const label = taken ? l10n.t('Remove line {0}', line) : l10n.t('Select line {0}', line);
    return html`<span class=${classMap({ 'commit-diff-lineno': true, 'merge-line-pick': true, 'merge-line-taken': taken })}
      role="button" tabindex="0" aria-pressed=${taken ? 'true' : 'false'} aria-label=${label} title=${label}
      @click=${() => { if (!state!.busy) { toggleLine(conflict, side, offset); } }}
      @keydown=${(event: KeyboardEvent) => {
        if ((event.key === 'Enter' || event.key === ' ') && !state!.busy) { event.preventDefault(); toggleLine(conflict, side, offset); }
      }}>${line}</span>`;
  }

  /** The buttons of a conflict show while the pointer or the focus is on it, as a diff's hunk buttons do. */
  function setHovered(conflict: number | undefined): void {
    if (state && state.hovered !== conflict) {
      state.hovered = conflict;
      paint();
    }
  }

  function hover(event: Event): void {
    const cell = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-conflict]') : null;
    setHovered(cell?.dataset.conflict === undefined ? undefined : Number(cell.dataset.conflict));
  }

  /** One side's lines, scrolling sideways on its own; all three panes scroll up and down together. */
  function pane(side: Side): TemplateResult {
    return html`<div class=${`merge-pane merge-pane-${side} code-viewer`} @mouseover=${hover} @focusin=${hover} @mouseleave=${() => setHovered(undefined)} @scroll=${(event: Event) => syncScroll(side, event.target as HTMLElement)}>${
      state!.rows.map((row) => cell(row, side))}</div>`;
  }

  /** The result is a text area over its own highlighted copy, so it can be typed in and still shows the editor's colors. */
  function resultPane(): TemplateResult {
    const text = resultOf();
    const lines = text.length === 0 ? [] : (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n');
    // Lines taken from a side are marked like the side's own; once the text is typed over, nothing is.
    const origins = state!.manual === undefined ? resultOrigins(state!.document, state!.choices) : [];
    return html`
      <div class="merge-editor-text">
        <pre class="merge-editor-code" aria-hidden="true">${lines.map((line, index) => html`<div class=${classMap({
          'merge-editor-line': true, 'merge-from-incoming': origins[index] === 'incoming', 'merge-from-current': origins[index] === 'current',
          'merge-from-open': origins[index] === 'open',
        })}><span class="commit-diff-lineno">${index + 1}</span><code>${
          state!.code.result[index] === undefined ? line : unsafeHTML(state!.code.result[index])}</code></div>`)}</pre>
        <textarea class="merge-editor-input" spellcheck="false" wrap="off" aria-label=${l10n.t('Result')} ?disabled=${state!.busy}
          .value=${live(text)} @input=${onEdit} @scroll=${(event: Event) => syncScroll('result', event.target as HTMLElement)}></textarea>
      </div>`;
  }

  function onEdit(event: Event): void {
    state!.manual = (event.target as HTMLTextAreaElement).value;
    paint();
    void highlightResult();
  }

  /** The height of a line in the sides and in the result, which are drawn differently; 0 when nothing is laid out. */
  const rowHeight = (): number => container.querySelector<HTMLElement>('.merge-cell')?.offsetHeight ?? 0;
  const lineHeight = (): number => container.querySelector<HTMLElement>('.merge-editor-line')?.offsetHeight ?? 0;
  /** The pane the person scrolled drives the others, so they do not chase each other. */
  let driver: 'incoming' | 'current' | 'result' | undefined;

  /** Keeps the three panes on the same lines: scrolling any one moves the others up or down, never sideways. */
  function syncScroll(source: 'incoming' | 'current' | 'result', element: HTMLElement): void {
    const code = container.querySelector<HTMLElement>('.merge-editor-code');
    if (source === 'result' && code) {
      code.style.transform = `translate(${-element.scrollLeft}px, ${-element.scrollTop}px)`;
    }
    const row = rowHeight();
    const line = lineHeight();
    if (!state || row === 0 || line === 0 || (driver !== undefined && driver !== source)) { return; }
    const panes = ['incoming', 'current'].map((side) => container.querySelector<HTMLElement>(`.merge-pane-${side}`)!);
    const input = container.querySelector<HTMLTextAreaElement>('.merge-editor-input')!;
    const map = state.manual === undefined ? resultLineMap(state.document, state.choices, state.rows) : state.rows.map((_, index) => index);
    driver = source;
    if (source === 'result') {
      const at = Math.max(0, map.findIndex((mapped) => mapped >= Math.floor(element.scrollTop / line)));
      for (const other of panes) { other.scrollTop = at * row + (element.scrollTop % line) * (row / line); }
    } else {
      const at = Math.min(state.rows.length - 1, Math.floor(element.scrollTop / row));
      for (const other of panes) { if (other !== element) { other.scrollTop = element.scrollTop; } }
      input.scrollTop = (map[at] ?? at) * line + (element.scrollTop % row) * (line / row);
    }
    requestAnimationFrame(() => { driver = undefined; });
  }

  const resultRegion = (): TemplateResult => html`<div class="merge-result" role="region" aria-label=${l10n.t('Result')}>${resultPane()}</div>`;

  /** The two sides with the result under them, apart by a bar that can be dragged; or the result between the sides. */
  function body(): TemplateResult {
    if (state!.layout === 'between') {
      return html`<div class="merge-columns">${pane('incoming')}${resultRegion()}${pane('current')}</div>`;
    }
    return html`<vscode-split-layout class="merge-split" split="horizontal" initial-handle-position="60%" reset-on-dbl-click
      .handlePosition=${`${state!.split}%`}
      @vsc-split-layout-change=${(event: CustomEvent<{ positionInPercentage: number }>) => { state!.split = event.detail.positionInPercentage; }}>
      <div slot="start" class="merge-panes" role="region" aria-keyshortcuts="Control+Alt+ArrowUp Control+Alt+ArrowDown"
        aria-label=${l10n.t('Incoming on the left, current on the right')}>${pane('incoming')}${pane('current')}</div>
      <div slot="end" class="merge-below">${resultRegion()}</div>
    </vscode-split-layout>`;
  }

  function setLayout(layout: 'below' | 'between'): void {
    if (!state || state.layout === layout) { return; }
    state.layout = layout;
    try {
      localStorage.setItem(LAYOUT_KEY, layout);
    } catch {
      // Without storage the choice lasts until the modal is closed.
    }
    paint();
  }

  const pathLabel = (): TemplateResult => {
    const slash = state!.path.lastIndexOf('/');
    return html`<span class="merge-path">${slash >= 0 ? state!.path.slice(0, slash + 1) : ''}<strong>${state!.path.slice(slash + 1)}</strong></span>`;
  };

  /** The conflict counter and the buttons that go between conflicts. */
  const nav = (): TemplateResult => html`
    <div class="merge-nav" role="group" aria-label=${l10n.t('Conflicts')}>
      <span class=${classMap({ 'merge-count': true, 'merge-count-done': done() })}
        title=${l10n.t('{0} of {1} conflicts resolved', resolved(), total())}
      >${resolved()}/${total()}</span>
      <vscode-toolbar-button icon=${ACTION_ICONS.previousChange} label=${l10n.t('Previous conflict')} title=${l10n.t('Previous conflict')}
        @click=${() => goTo(state!.active - 1)}></vscode-toolbar-button>
      <vscode-toolbar-button icon=${ACTION_ICONS.nextChange} label=${l10n.t('Next conflict')} title=${l10n.t('Next conflict')}
        @click=${() => goTo(state!.active + 1)}></vscode-toolbar-button>
    </div>`;

  function template(): TemplateResult {
    if (!state || message) {
      return html`<div class=${message?.error ? 'merge-message merge-error' : 'merge-message'} role=${message?.error ? 'alert' : nothing}>
        ${message?.text ?? ''}
        ${state ? html`<vscode-button type="button" secondary @click=${openInEditor}>${l10n.t('Open in editor')}</vscode-button>` : nothing}
      </div>`;
    }
    const header = frame.extras ? nothing : html`<div class="merge-title">${pathLabel()}${nav()}</div>`;
    return html`
      <header class="merge-header">
        ${header}
        <div class="merge-sides">${sideCard('incoming')}${sideCard('current')}</div>
      </header>
      <div class="merge-body">${body()}</div>
      <footer class="merge-footer">
        <vscode-toolbar-button icon=${ACTION_ICONS.mergeLayout} toggleable .checked=${state.layout === 'between'}
          label=${l10n.t('Show the result between the two sides')} title=${l10n.t('Show the result between the two sides')}
          @change=${(event: Event) => setLayout((event.target as HTMLElement & { checked: boolean }).checked ? 'between' : 'below')}></vscode-toolbar-button>
        <vscode-button type="button" secondary @click=${openInEditor}>${l10n.t('Open in editor')}</vscode-button>
        <span class="merge-footer-space"></span>
        <vscode-button type="button" secondary ?disabled=${state.busy} @click=${() => postMessage({ type: 'mergeCancel', path: state!.path })}
          >${l10n.t('Cancel')}</vscode-button>
        <vscode-button type="button" ?disabled=${!done() || state.busy} @click=${resolve}>${l10n.t('Resolve')}</vscode-button>
      </footer>`;
  }

  function paint(): void {
    render(template(), container);
    if (frame.extras) { render(state && !message ? nav() : nothing, frame.extras); }
    if (frame.title) { frame.title.textContent = state ? l10n.t('Merge: {0}', state.path) : l10n.t('Merge'); }
    matchLineHeights();
  }

  /** The result is drawn apart from the sides; it takes the height their lines have, so all three line up. */
  function matchLineHeights(): void {
    const row = rowHeight();
    if (row > 0 && container.style.getPropertyValue('--merge-line-height') !== `${row}px`) {
      container.style.setProperty('--merge-line-height', `${row}px`);
    }
  }

  function openInEditor(): void {
    if (state) { postMessage({ type: 'mergeOpenInEditor', path: state.path }); }
  }

  function resolve(): void {
    if (state && done() && !state.busy) {
      const text = fileText(state.document, resultOf());
      state.busy = true;
      paint();
      postMessage({ type: 'mergeResolve', path: state.path, text });
    }
  }

  /** Moves to a conflict, wrapping around, and shows its first row. */
  function goTo(conflict: number): void {
    if (!state || total() === 0) { return; }
    state.active = ((conflict % total()) + total()) % total();
    paint();
    container.querySelector(`.merge-pane-incoming .merge-cell[data-conflict="${state.active}"][data-first]`)?.scrollIntoView({ block: 'center' });
  }

  /** The choices changed: draw again, and highlight the new result. */
  function changed(): void {
    state!.manual = undefined;
    paint();
    void highlightResult();
  }

  async function highlightResult(): Promise<void> {
    if (!state) { return; }
    const current = ++generation;
    const lines = resultOf().split('\n').slice(0, resultOf().endsWith('\n') ? -1 : undefined).map((text) => ({ kind: 'context', text }));
    const marked = await highlight(state.path, lines).catch(() => lines.map((line) => escapeHtml(line.text)));
    if (state && current === generation) {
      state.code.result = marked;
      paint();
    }
  }

  async function highlightSides(): Promise<void> {
    if (!state) { return; }
    const current = ++generation;
    const column = (side: 'left' | 'right') => state!.rows.flatMap((row) => (row[side] ? [{ kind: 'context', text: row[side]!.text }] : []));
    const [incoming, currentSide] = await Promise.all([
      highlight(state.path, column('left')).catch(() => []),
      highlight(state.path, column('right')).catch(() => []),
    ]);
    if (state && current === generation) {
      state.code.incoming = incoming;
      state.code.current = currentSide;
      paint();
      void highlightResult();
    }
  }

  return {
    applyHostMessage(host: MergeHostMessage): void {
      if (host.type === 'editorTokenColors') {
        applyTokenColors(container, host.colors);
        return;
      }
      if (host.type === 'mergeError') {
        message = { text: host.message, error: true };
        if (state) { state.busy = false; }
        paint();
        return;
      }
      if (host.type !== 'mergeInit') { return; }
      const document = parseMergeDocument(host.text);
      const conflicts = conflictsOf(document);
      state = {
        path: host.path,
        incoming: host.incoming,
        current: host.current,
        document,
        rows: paneRows(document, sidesOf(host)),
        choices: conflicts.map(unresolved),
        manual: undefined,
        active: 0,
        hovered: undefined,
        code: { incoming: [], current: [], result: [] },
        busy: false,
        layout: storedLayout(),
        split: 60,
      };
      message = conflicts.length === 0
        ? { text: l10n.t('This file has no conflict markers. Resolve it in the editor.'), error: false }
        : undefined;
      paint();
      if (conflicts.length > 0) {
        container.querySelector('.merge-cell[data-first]')?.scrollIntoView({ block: 'center' });
        void highlightSides();
      }
    },
  };
}
