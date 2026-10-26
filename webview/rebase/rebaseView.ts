import * as l10n from '@vscode/l10n';
import { html, nothing, render, type TemplateResult } from 'lit';
import { classMap } from 'lit/directives/class-map.js';
import { live } from 'lit/directives/live.js';
import { repeat } from 'lit/directives/repeat.js';
import type {
  RebaseCommitCommand,
  RebaseEditorStateDto,
  RebaseHostMessage,
  RebaseTodoCommitDto,
  RebaseWebviewMessage,
} from './protocol';
import { githubLinkedText } from '../githubLinkText';
import { commitSummaryTemplate } from '../details/commitSummary';
import type { CommitPersonDto } from '../protocol';
import type { VscodeCheckbox } from '@vscode-elements/elements/dist/vscode-checkbox/index.js';
import type { VscodeSingleSelect } from '@vscode-elements/elements/dist/vscode-single-select/index.js';
import type { VscodeTextarea } from '@vscode-elements/elements/dist/vscode-textarea/index.js';
import type { VscodeTextfield } from '@vscode-elements/elements/dist/vscode-textfield/index.js';

const COMMANDS: { command: RebaseCommitCommand; label: string; description: string; key: string }[] = [
  { command: 'pick', label: l10n.t('Pick'), description: l10n.t('Use commit'), key: 'P' },
  { command: 'edit', label: l10n.t('Edit'), description: l10n.t('Stop for amending'), key: 'E' },
  { command: 'reword', label: l10n.t('Reword'), description: l10n.t('Edit the commit message'), key: 'R' },
  { command: 'squash', label: l10n.t('Squash'), description: l10n.t('Meld into previous commit and keep message'), key: 'S' },
  { command: 'fixup', label: l10n.t('Fixup'), description: l10n.t('Meld into previous commit and discard message'), key: 'F' },
  { command: 'drop', label: l10n.t('Drop'), description: l10n.t('Remove commit'), key: 'D' },
];

type PointerKeys = { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean };

/** Which of the connector's parts a row draws: where a squash or fixup starts, passes, and lands. */
function foldConnections(displayLines: readonly RebaseTodoCommitDto[]) {
  const targets = new Map<string, string>();
  const connections = new Map<string, Set<string>>();
  for (const [index, line] of displayLines.entries()) {
    if (line.command !== 'squash' && line.command !== 'fixup') { continue; }
    const targetIndex = displayLines.findIndex((entry, candidate) => candidate > index
      && entry.command !== 'drop' && entry.command !== 'squash' && entry.command !== 'fixup');
    if (targetIndex < 0) { continue; }
    targets.set(line.hash, displayLines[targetIndex].hash);
    for (let position = index; position <= targetIndex; position++) {
      const hash = displayLines[position].hash;
      const parts = connections.get(hash) ?? new Set<string>();
      if (position === index) { parts.add('source'); }
      if (position > index) { parts.add('incoming'); }
      if (position < targetIndex) { parts.add('outgoing'); }
      if (position === targetIndex) { parts.add('target'); }
      connections.set(hash, parts);
    }
  }
  return { targets, connections };
}

export function mountRebaseView(
  root: HTMLElement,
  postMessage: (message: RebaseWebviewMessage) => void,
): { applyHostMessage(message: RebaseHostMessage): void } {
  let state: RebaseEditorStateDto | undefined;
  let reorderId = 0;
  let pendingReorderId = 0;
  let acknowledgedReorderId = 0;
  let failure: string | undefined;
  let dragFrom = -1;
  let activeHash: string | undefined;
  const selected = new Set<string>();
  const commitDetails = new Map<string, { body: string; committer: CommitPersonDto }>();
  const requestedDetails = new Set<string>();
  /** The reword dialog: which commit it edits, whether its message has arrived, and the draft. */
  const editor = { hash: undefined as string | undefined, loaded: false, subject: '', message: '' };

  const part = <T extends HTMLElement>(selector: string): T | null => root.querySelector<T>(selector);
  const rowOf = (hash: string | undefined): HTMLElement | null =>
    [...root.querySelectorAll<HTMLElement>('.rebase-row')].find((row) => row.dataset.hash === hash) ?? null;

  // --- the reword dialog ---

  const draftIsValid = (): boolean => !!editor.subject.trim()
    && !editor.subject.includes('\0') && !editor.message.includes('\0');

  function positionMessageEditor(): void {
    const dialog = part<HTMLDialogElement>('.rebase-message-editor');
    const anchor = rowOf(editor.hash);
    if (!dialog || !anchor) { return; }
    const rowRect = anchor.getBoundingClientRect();
    const editorRect = dialog.getBoundingClientRect();
    dialog.style.left = `${Math.max(16, Math.min(rowRect.left, window.innerWidth - editorRect.width - 16))}px`;
    dialog.style.top = `${Math.max(16, Math.min(rowRect.bottom, window.innerHeight - editorRect.height - 16))}px`;
  }

  function closeMessageEditor(): void {
    const hash = editor.hash;
    editor.hash = undefined;
    part<HTMLDialogElement>('.rebase-message-editor')?.close();
    window.removeEventListener('resize', positionMessageEditor);
    paint();
    rowOf(hash)?.querySelector<HTMLElement>('.rebase-subject')?.focus();
  }

  function loadMessageEditor(): void {
    if (!editor.hash || editor.loaded) { return; }
    const line = state?.lines.find((entry) => entry.hash === editor.hash);
    if (!line || state?.sequencer.active) {
      closeMessageEditor();
      return;
    }
    if (line.message === undefined) { return; }
    const newline = line.message.indexOf('\n');
    editor.subject = newline < 0 ? line.message : line.message.slice(0, newline);
    editor.message = newline < 0 ? '' : line.message.slice(newline + 1).replace(/^\r?\n/, '');
    editor.loaded = true;
    paint();
    part('.rebase-message-editor .rebase-message')?.focus();
  }

  function openMessageEditor(hash: string): void {
    editor.hash = hash;
    editor.loaded = false;
    editor.subject = state?.lines.find((entry) => entry.hash === hash)?.subject ?? '';
    editor.message = '';
    paint();
    part<HTMLDialogElement>('.rebase-message-editor')?.showModal();
    positionMessageEditor();
    window.addEventListener('resize', positionMessageEditor);
    loadMessageEditor();
    if (!editor.loaded) { postMessage({ type: 'rebaseEditMessage', hash }); }
  }

  function saveMessageEditor(): void {
    const line = state?.lines.find((entry) => entry.hash === editor.hash);
    if (!line || !editor.loaded || !draftIsValid()) { return; }
    line.message = editor.subject + (editor.message ? `\n\n${editor.message}` : '');
    line.command = 'reword';
    postMessage({ type: 'rebaseSetMessage', hash: line.hash, message: line.message });
    postMessage({ type: 'rebaseSetCommand', hash: line.hash, command: 'reword' });
    closeMessageEditor();
  }

  // --- selection and the list ---

  function activate(hash: string): void {
    activeHash = hash;
    if (state?.lines.some((entry) => entry.hash === hash) && !requestedDetails.has(hash)) {
      requestedDetails.add(hash);
      postMessage({ type: 'rebaseRequestCommitDetails', hash });
    }
  }

  function chooseCommit(hash: string, event: PointerKeys): void {
    if (!state) { return; }
    if (event.shiftKey && activeHash) {
      const from = state.lines.findIndex((line) => line.hash === activeHash);
      const to = state.lines.findIndex((line) => line.hash === hash);
      if (!event.metaKey && !event.ctrlKey) { selected.clear(); }
      for (const line of state.lines.slice(Math.min(from, to), Math.max(from, to) + 1)) {
        selected.add(line.hash);
      }
    } else if (event.metaKey || event.ctrlKey) {
      if (selected.has(hash)) { selected.delete(hash); } else { selected.add(hash); }
    } else {
      selected.clear();
      selected.add(hash);
    }
    activate(hash);
    paint();
  }

  function reorderCommits(fromIndex: number, toIndex: number): void {
    if (!state || state.sequencer.active) { return; }
    const lines = [...state.lines];
    const [line] = lines.splice(fromIndex, 1);
    lines.splice(toIndex, 0, line);
    selected.clear();
    selected.add(line.hash);
    activeHash = line.hash;
    state = { ...state, lines };
    pendingReorderId = ++reorderId;
    refresh();
    postMessage({ type: 'rebaseReorder', fromIndex, toIndex, reorderId });
  }

  function setCommand(line: RebaseTodoCommitDto, index: number, command: RebaseCommitCommand): void {
    if (!state) { return; }
    const folds = command === 'squash' || command === 'fixup';
    if (folds && !state.lines.slice(0, index).some((entry) => entry.command !== 'drop')) {
      paint();
      return;
    }
    if (command === 'reword') {
      chooseCommit(line.hash, { shiftKey: false, metaKey: false, ctrlKey: false });
      openMessageEditor(line.hash);
      return;
    }
    line.command = command;
    chooseCommit(line.hash, { shiftKey: false, metaKey: false, ctrlKey: false });
    postMessage({ type: 'rebaseSetCommand', hash: line.hash, command });
    refresh();
  }

  function moveCommit(index: number, hash: string, offset: number): void {
    const toIndex = index - offset;
    if (!state || state.sequencer.active || toIndex < 0 || toIndex >= state.lines.length) { return; }
    chooseCommit(hash, { shiftKey: false, metaKey: false, ctrlKey: false });
    reorderCommits(index, toIndex);
  }

  /** The keys that move a commit, on its action dropdown and on its subject. */
  function moveKey(event: KeyboardEvent, index: number, hash: string): void {
    if (event.altKey || (!event.metaKey && !event.ctrlKey)
      || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) { return; }
    event.preventDefault();
    event.stopPropagation();
    moveCommit(index, hash, event.key === 'ArrowUp' ? -1 : 1);
  }

  function subjectKey(
    event: KeyboardEvent, line: RebaseTodoCommitDto, index: number, displayIndex: number,
    displayLines: readonly RebaseTodoCommitDto[],
  ): void {
    if (event.target !== event.currentTarget || event.altKey || state?.sequencer.active) { return; }
    if (event.metaKey || event.ctrlKey) {
      moveKey(event, index, line.hash);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      const nextIndex = displayIndex + (event.key === 'ArrowUp' ? -1 : 1);
      const next = displayLines[nextIndex];
      if (!next) { return; }
      chooseCommit(next.hash, event);
      const nextSubject = rowOf(next.hash)?.querySelector<HTMLElement>('.rebase-subject');
      nextSubject?.focus({ preventScroll: true });
      nextSubject?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      chooseCommit(line.hash, event);
      return;
    }
    const action = COMMANDS.find((entry) => entry.key.toLowerCase() === event.key.toLowerCase());
    if (!action) { return; }
    event.preventDefault();
    setCommand(line, index, action.command);
  }

  // --- the templates ---

  function rowTemplate(
    line: RebaseTodoCommitDto, displayIndex: number, displayLines: readonly RebaseTodoCommitDto[],
    folds: ReturnType<typeof foldConnections>,
  ): TemplateResult {
    const current = state!;
    const index = current.lines.length - 1 - displayIndex;
    const displaySubject = line.command === 'reword' ? line.message?.split('\n', 1)[0] ?? line.subject : line.subject;
    const foldTarget = folds.targets.get(line.hash);
    const target = foldTarget ? displayLines.find((entry) => entry.hash === foldTarget) : undefined;
    const commit = current.commits.find((entry) => entry.sha === line.hash || entry.sha.startsWith(line.hash));
    const isSelected = selected.has(line.hash);
    const canFold = current.lines.slice(0, index).some((entry) => entry.command !== 'drop');
    const action = COMMANDS.find((entry) => entry.command === line.command);
    const description = line.command === 'drop' ? l10n.t('Dropped commit; excluded from rebase')
      : target ? l10n.t('Folds into {0} below', target.subject) : undefined;

    return html`
      <div class=${classMap({
        'rebase-row': true, 'rebase-fixup': line.command === 'fixup', 'rebase-dropped': line.command === 'drop', selected: isSelected,
      })} draggable="true" data-index=${index} data-hash=${line.hash} data-fold-target=${foldTarget ?? nothing}
        role="row" aria-selected=${String(isSelected)} aria-description=${description ?? nothing}
        @dragstart=${() => { dragFrom = index; }}
        @dragover=${(event: Event) => event.preventDefault()}
        @drop=${(event: Event) => {
          event.preventDefault();
          if (dragFrom >= 0 && dragFrom !== index) { reorderCommits(dragFrom, index); }
          dragFrom = -1;
        }}
        @click=${(event: MouseEvent) => {
          if (event.target instanceof HTMLElement && event.target.closest('select, button, a, vscode-single-select')) { return; }
          chooseCommit(line.hash, event);
          (event.currentTarget as HTMLElement).querySelector<HTMLElement>('.rebase-subject')?.focus({ preventScroll: true });
        }}>
        <div role="gridcell">
          <vscode-single-select class="rebase-cmd" aria-label=${l10n.t('Action for {0}', displaySubject)}
            title=${action ? l10n.t('{0} ({1})', l10n.t(action.description), action.key) : nothing}
            .value=${live(line.command)}
            @keydown=${(event: KeyboardEvent) => moveKey(event, index, line.hash)}
            @change=${(event: Event) => {
              const value = (event.target as VscodeSingleSelect).value;
              const chosen = COMMANDS.find((entry) => entry.command === value);
              if (chosen) { setCommand(line, index, chosen.command); }
            }}>
            ${COMMANDS.map((c) => html`
              <vscode-option value=${c.command} description=${l10n.t('{0} ({1})', l10n.t(c.description), c.key)}
                ?selected=${c.command === line.command} ?disabled=${(c.command === 'squash' || c.command === 'fixup') && !canFold}
              >${l10n.t(c.label)}</vscode-option>`)}
          </vscode-single-select>
        </div>
        <div role="gridcell" class="rebase-subject-cell">
          <span class=${['rebase-fold-connector', ...(folds.connections.get(line.hash) ?? [])].join(' ')} aria-hidden="true"></span>
          <span class="rebase-subject" tabindex="0" role="button" aria-label=${l10n.t('Preview {0}', displaySubject)}
            aria-keyshortcuts="ArrowUp ArrowDown p e r s f d Control+ArrowUp Control+ArrowDown Meta+ArrowUp Meta+ArrowDown"
            title=${l10n.t('{0}\nUp/Down selects a commit. P Pick, E Edit, R Reword, S Squash, F Fixup, D Drop. Ctrl/Cmd+Up/Down moves this commit.', displaySubject)}
            @keydown=${(event: KeyboardEvent) => subjectKey(event, line, index, displayIndex, displayLines)}
          >${githubLinkedText(displaySubject, current.github, (url) => postMessage({ type: 'openGitHubLink', url }))}</span>
        </div>
        <div role="gridcell"><span class="rebase-author">${commit?.author ?? ''}</span></div>
        <div role="gridcell"><code class="rebase-hash">${line.hash.slice(0, 7)}</code></div>
        <div role="gridcell"><span class="rebase-date">${commit?.authorDate ? new Date(commit.authorDate * 1000).toLocaleString() : ''}</span></div>
      </div>`;
  }

  function previewTemplate(): TemplateResult {
    const current = state;
    const hash = activeHash ?? '';
    const line = current?.lines.find((entry) => entry.hash === hash);
    const commit = current?.commits.find((entry) => entry.sha === hash || entry.sha.startsWith(hash));
    const details = commitDetails.get(hash);
    const draft = line?.command === 'reword' ? line.message : undefined;
    const [draftSubject, ...draftBody] = draft?.split('\n') ?? [];
    return commitSummaryTemplate({
      commit: commit ?? (line ? {
        sha: hash, subject: line.subject, author: '', authorEmail: '', authorDate: 0, parents: [], refs: [],
      } : null),
      subject: draftSubject ?? commit?.subject ?? line?.subject ?? l10n.t('No commits to rebase'),
      body: draft !== undefined ? draftBody.join('\n').replace(/^\n/, '') : details?.body ?? '',
      github: current?.github ?? null,
    }, (url) => postMessage({ type: 'openGitHubLink', url }));
  }

  function template(): TemplateResult {
    const current = state;
    const inProgress = current?.sequencer.active ?? false;
    const displayLines = current ? [...current.lines].reverse() : [];
    const folds = foldConnections(displayLines);
    const warns = current !== undefined && current.riskyCount > 0 && !inProgress;
    const showsProgress = inProgress && (current?.sequencer.end ?? 0) > 0;
    const draftValid = draftIsValid();
    const invalidSubject = editor.loaded && !draftValid;
    return html`
      <div class="rebase-shell rebase-editor">
        <div class="rebase-toolbar">
          <span class="rebase-current-branch">${current ? l10n.t('Rebase: {0}', current.branch ?? 'HEAD') : ''}</span>
          <label>${l10n.t('On')}
            <vscode-textfield class="rebase-input" .value=${live(current?.onto ?? '')}
              @change=${(event: Event) => postMessage({ type: 'rebaseSetOnto', onto: (event.target as VscodeTextfield).value })}
            ></vscode-textfield>
          </label>
          <vscode-checkbox class="rebase-check" label=${l10n.t('Update dependent branches')}
            .checked=${live(current?.updateRefs ?? false)}
            @change=${(event: Event) => postMessage({ type: 'rebaseToggleUpdateRefs', enabled: (event.target as VscodeCheckbox).checked })}
          ></vscode-checkbox>
        </div>
        <div class=${classMap({ 'rebase-progress': true, hidden: !showsProgress })}>
          <span>${showsProgress ? current?.sequencer.summary : ''}</span>
        </div>
        <div class=${classMap({ 'rebase-warning': true, hidden: !warns })}>
          <span>${warns ? l10n.t('{0} commit(s) may conflict when replayed onto {1}.', current.riskyCount, current.onto) : ''}</span>
        </div>
        <div class=${classMap({ 'rebase-error': true, hidden: failure === undefined })}><span>${failure ?? ''}</span></div>
        <div class="rebase-list" role="grid" aria-multiselectable="true" aria-label=${l10n.t('Commits to rebase')}>
          ${repeat(displayLines, (line) => line.hash, (line, displayIndex) => rowTemplate(line, displayIndex, displayLines, folds))}
        </div>
        <section class="rebase-preview" aria-label=${l10n.t('Selected commit')}>${previewTemplate()}</section>
        <div class="rebase-footer">
          <vscode-checkbox class="rebase-check" label=${l10n.t('Stash and reapply local changes')}
            .checked=${live(current?.stashDirty ?? false)}
            @change=${(event: Event) => postMessage({ type: 'rebaseToggleStash', enabled: (event.target as VscodeCheckbox).checked })}
          ></vscode-checkbox>
          <vscode-button type="button" class=${classMap({ hidden: inProgress })}
            @click=${() => postMessage({ type: 'rebaseStart' })}>${l10n.t('Rebase')}</vscode-button>
          <!-- While a rebase runs, Continue, Skip and Abort are the three ways to go on, so they are one button group. -->
          <vscode-button-group class=${classMap({ 'rebase-progress-actions': true, hidden: !inProgress })}>
            <vscode-button type="button" secondary @click=${() => postMessage({ type: 'rebaseContinue' })}>${l10n.t('Continue')}</vscode-button>
            <vscode-button type="button" secondary @click=${() => postMessage({ type: 'rebaseSkip' })}>${l10n.t('Skip')}</vscode-button>
            <vscode-button type="button" secondary @click=${() => postMessage({ type: 'rebaseAbort' })}>${l10n.t('Abort')}</vscode-button>
          </vscode-button-group>
        </div>
        <dialog class="rebase-message-editor" aria-label=${l10n.t('Reword commit')} aria-busy=${String(editor.hash !== undefined && !editor.loaded)}
          @cancel=${(event: Event) => { event.preventDefault(); closeMessageEditor(); }}
          @keydown=${(event: KeyboardEvent) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              closeMessageEditor();
            } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              saveMessageEditor();
            }
          }}>
          <vscode-textfield class="rebase-message" placeholder=${l10n.t('Commit subject')} aria-label=${l10n.t('Commit subject')}
            .value=${live(editor.subject)} ?disabled=${!editor.loaded} ?invalid=${invalidSubject}
            title=${invalidSubject ? l10n.t('Enter a non-empty subject without null characters.') : ''}
            @input=${(event: Event) => { editor.subject = (event.target as VscodeTextfield).value; paint(); }}></vscode-textfield>
          <vscode-textarea class="rebase-message" rows="4" placeholder=${l10n.t('Commit message')} aria-label=${l10n.t('Commit message')}
            .value=${live(editor.message)} ?disabled=${!editor.loaded}
            @input=${(event: Event) => { editor.message = (event.target as VscodeTextarea).value; paint(); }}></vscode-textarea>
          <vscode-button-group class="rebase-actions">
            <vscode-button type="button" secondary @click=${closeMessageEditor}>${l10n.t('Cancel')}</vscode-button>
            <vscode-button type="button" ?disabled=${!editor.loaded || !draftValid} @click=${saveMessageEditor}>${l10n.t('OK')}</vscode-button>
          </vscode-button-group>
        </dialog>
      </div>`;
  }

  /** Draws the view. Rows keep their elements between draws, but one that moves in the list loses focus, so it is given back. */
  function paint(): void {
    const focused = document.activeElement;
    const keepSubject = focused?.classList.contains('rebase-subject');
    const keepCommand = focused?.classList.contains('rebase-cmd');
    const scrollTop = part('.rebase-list')?.scrollTop ?? 0;
    render(template(), root);
    const list = part('.rebase-list');
    if (list) { list.scrollTop = scrollTop; }
    if (keepSubject || keepCommand) {
      const target = rowOf(activeHash)?.querySelector<HTMLElement>(keepSubject ? '.rebase-subject' : '.rebase-cmd');
      if (target && document.activeElement !== target) { target.focus({ preventScroll: true }); }
    }
  }

  /** Drops selections of commits that are gone, selects the first when nothing is, and draws. */
  function refresh(): void {
    if (!state) { return; }
    for (const hash of selected) {
      if (!state.lines.some((line) => line.hash === hash)) { selected.delete(hash); }
    }
    const displayLines = [...state.lines].reverse();
    const active = state.lines.find((line) => line.hash === activeHash) ?? displayLines[0];
    if (active && activeHash === undefined) { selected.add(active.hash); }
    activate(active?.hash ?? '');
    paint();
    if ((document.activeElement as HTMLElement | null)?.matches?.('.rebase-subject, .rebase-cmd')) {
      document.activeElement?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function applyState(next: RebaseEditorStateDto): void {
    if (state?.repoRoot === next.repoRoot && state.onto === next.onto
      && state.upstream === next.upstream && (next.reorderId ?? 0) < acknowledgedReorderId) { return; }
    acknowledgedReorderId = next.reorderId ?? 0;
    reorderId = Math.max(reorderId, acknowledgedReorderId);
    if (pendingReorderId && (next.reorderId ?? 0) < pendingReorderId
      && state && next.repoRoot === state.repoRoot
      && next.onto === state.onto && next.upstream === state.upstream
      && !next.sequencer.active) {
      const incoming = new Map(next.lines.map((line) => [line.hash, line]));
      if (incoming.size === state.lines.length && state.lines.every((line) => incoming.has(line.hash))) {
        next = { ...next, lines: state.lines.map((line) => incoming.get(line.hash)!) };
      } else {
        pendingReorderId = 0;
      }
    } else {
      pendingReorderId = 0;
    }
    state = next;
    refresh();
    loadMessageEditor();
  }

  render(nothing, root);
  paint();

  return {
    applyHostMessage(message: RebaseHostMessage): void {
      if (message.type === 'rebaseCommitDetails') {
        if (!requestedDetails.has(message.hash)) { return; }
        commitDetails.set(message.hash, { body: message.body, committer: message.committer });
        if (activeHash === message.hash && state) { paint(); }
        return;
      }
      if (message.type === 'rebaseCommitDetailsError') {
        if (!requestedDetails.delete(message.hash)) { return; }
        failure = message.message;
        paint();
        return;
      }
      if (message.type === 'rebaseClose') {
        pendingReorderId = 0;
        commitDetails.clear();
        requestedDetails.clear();
        if (editor.hash) { closeMessageEditor(); }
        return;
      }
      if (message.type === 'rebaseError') {
        if (pendingReorderId) {
          pendingReorderId = 0;
          postMessage({ type: 'rebaseRefresh' });
        }
        if (editor.hash) { closeMessageEditor(); }
        failure = message.message;
        paint();
        return;
      }
      if (message.type === 'rebaseBootstrap' || message.type === 'rebaseState') {
        if (editor.hash && (message.state.sequencer.active
          || !message.state.lines.some((line) => line.hash === editor.hash))) {
          closeMessageEditor();
        }
        failure = undefined;
        applyState(message.state);
      }
    },
  };
}
