import * as l10n from '@vscode/l10n';
import { html, nothing, render, type TemplateResult } from 'lit';
import { styleMap } from 'lit/directives/style-map.js';
import { classMap } from 'lit/directives/class-map.js';
import { live } from 'lit/directives/live.js';
import { repeat } from 'lit/directives/repeat.js';
import { authorColor, authorInitials, formatCommitDate, type WebviewMessage } from '../protocol';
import type { CommitDiffViewOptions } from '../../src/shared/diff/commitDiffPresentation';
import { DEFAULT_COMMIT_DIFF_VIEW } from '../../src/shared/diff/commitDiffPresentation';
import { DEFAULT_WORKING_COPY_DIFF_VIEW_OPTIONS } from '../../src/shared/diff/diffViewOptions';
import type { GitHubRepository } from '../../src/shared/history/githubReferences';
import type { GraphCommitDto } from '../../src/shared/graph/graphProtocol';
import type { CommitDiffLineDto } from '../../src/shared/history/commitDetailsProtocol';
import type {
  PathHistoryHostMessage,
  PathHistoryViewOption,
} from '../../src/shared/history/pathHistoryProtocol';
import { mountCodeViewer } from '../details/codeViewer';
import { renderNonTextDiff } from '../details/nonTextDiffView';
import { githubLinkedText } from '../githubLinkText';
import { mountDiffToolbar } from '../details/diffToolbar';
import { createModalShell } from '../modalShell';
import type { VscodeSingleSelect } from '@vscode-elements/elements/dist/vscode-single-select/index.js';
import { blameGutter } from '../blame/blameGutter';
import type { BlameCommitDto } from '../../src/shared/history/pathHistoryProtocol';
import { ACTION_ICONS } from '../../src/shared/app/actionIcons';

const LOAD_MORE_THRESHOLD_PX = 240;

/**
 * The History modal over the main panel: the commits that touched a file, folder or hunk on the
 * left and the selected commit's change on the right. It uses the shared modal shell.
 */
export function mountHistoryModal(
  shell: HTMLElement,
  post: (message: WebviewMessage) => void,
  options: { blame?: boolean } = {},
): {
  applyHostMessage(message: PathHistoryHostMessage): void;
  setViewOptions(options: CommitDiffViewOptions): void;
} {
  const modal = createModalShell(shell, {
    className: options.blame ? 'history-modal blame-modal' : 'history-modal',
    title: options.blame ? l10n.t('Blame') : l10n.t('History'),
    onDismiss: () => dismiss(),
  });
  modal.body.classList.add(options.blame ? 'blame-body' : 'history-body');

  // The Blame modal shows the diff one way only, with the blame beside each line, so it has no side-by-side button.
  const toolbar = mountDiffToolbar((option) => post({
    type: 'pathHistoryViewOption', option: option as PathHistoryViewOption,
  }), options.blame ? { options: ['ignoreWhitespace', 'invisibles', 'wrap', 'moreContext', 'lessContext', 'fullFile'] } : {});
  const diff = document.createElement('div');
  diff.className = 'history-diff commit-file-diff';
  const viewer = mountCodeViewer(diff);
  viewer.showMessage(l10n.t('Select a commit to see its change.'));

  const history = {
    path: '', scope: 'file' as 'file' | 'directory' | 'hunk', canFollow: false, follow: false, merges: false,
    summary: '', commits: [] as GraphCommitDto[], github: null as GitHubRepository | null,
    hasMore: false, loadingMore: false, selectedSha: null as string | null,
  };
  /** The Blame modal: the commit that last changed each line of the selected commit's diff. */
  const blame = { shas: [] as string[], commits: {} as Record<string, BlameCommitDto>, lines: [] as CommitDiffLineDto[] };
  /** A commit the host asked to select once the list has it. */
  let wantedSha: string | null = null;
  let renderedSha: string | null = null;
  let viewOptions: CommitDiffViewOptions = { ...DEFAULT_COMMIT_DIFF_VIEW };

  const list = (): HTMLElement | null => modal.body.querySelector<HTMLElement>('.history-list');

  function dismiss(): void {
    post({ type: 'pathHistoryClose' });
    modal.hide();
  }

  function select(sha: string): void {
    if (history.selectedSha === sha) { return; }
    history.selectedSha = sha;
    paint();
    post({ type: 'pathHistorySelect', sha });
  }

  function move(delta: number): void {
    const index = history.commits.findIndex((commit) => commit.sha === history.selectedSha);
    const next = history.commits[Math.min(history.commits.length - 1, Math.max(0, index + delta))];
    if (next) {
      select(next.sha);
      list()?.querySelector<HTMLElement>(`[data-sha="${next.sha}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }

  function rowTemplate(commit: GraphCommitDto, now: Date): TemplateResult {
    const selected = commit.sha === history.selectedSha;
    return html`
      <div class=${classMap({ 'history-row': true, selected })} data-sha=${commit.sha} role="option"
        aria-selected=${String(selected)} title=${commit.sha}
        @click=${() => { list()?.focus(); select(commit.sha); }}>
        <div class="history-row-top">
          <span class="graph-avatar" style=${styleMap({ background: `var(--graph-lane-${authorColor(commit.authorEmail)})` })}
            >${authorInitials(commit.author)}${commit.avatarUrl
              ? html`<img alt="" src=${commit.avatarUrl} @error=${(event: Event) => (event.target as HTMLElement).remove()}>`
              : nothing}</span>
          <span class="history-author">${commit.author}</span>
          <span class="history-meta">${formatCommitDate(commit.authorDate, now)}</span>
          <span class="history-meta">${commit.sha.slice(0, 7)}</span>
          <vscode-toolbar-button class="history-open" icon=${ACTION_ICONS.openFile} label=${l10n.t('Open in Editor')}
            title=${l10n.t('Open in Editor')} @click=${(event: Event) => {
              event.stopPropagation();
              post({ type: 'pathHistoryOpenInEditor', sha: commit.sha });
            }}></vscode-toolbar-button>
        </div>
        <div class="history-subject" title=${commit.subject}
        >${githubLinkedText(commit.subject, history.github, (url) => post({ type: 'openGitHubLink', url }))}</div>
      </div>`;
  }

  /** The Blame modal has no commit list: arrows and a dropdown in the header step through the file's commits. */
  function paintBlame(now: Date): void {
    const index = history.commits.findIndex((commit) => commit.sha === history.selectedSha);
    const label = (commit: GraphCommitDto): string =>
      `${commit.sha.slice(0, 7)} | ${commit.subject} (${formatCommitDate(commit.authorDate, now)})`;
    const step = (delta: number): void => {
      const next = history.commits[index + delta];
      if (next) { select(next.sha); }
    };
    render(html`
      <span class="history-path" title=${history.path}>${history.path}</span>
      <vscode-button-group class="blame-steps">
        <vscode-button type="button" secondary icon=${ACTION_ICONS.olderCommit} icon-only title=${l10n.t('Older commit')}
          aria-label=${l10n.t('Older commit')} ?disabled=${index < 0 || index >= history.commits.length - 1}
          @click=${() => step(1)}></vscode-button>
        <vscode-button type="button" secondary icon=${ACTION_ICONS.newerCommit} icon-only title=${l10n.t('Newer commit')}
          aria-label=${l10n.t('Newer commit')} ?disabled=${index <= 0} @click=${() => step(-1)}></vscode-button>
      </vscode-button-group>
      <vscode-single-select class="blame-commit-select" aria-label=${l10n.t('Commit')} .value=${live(history.selectedSha ?? '')}
        ?disabled=${history.commits.length === 0} @change=${(event: Event) => select((event.target as VscodeSingleSelect).value)}>
        ${history.commits.map((commit) => html`<vscode-option value=${commit.sha} ?selected=${commit.sha === history.selectedSha}
          >${label(commit)}</vscode-option>`)}
      </vscode-single-select>
      <vscode-toolbar-button icon=${ACTION_ICONS.openFile} label=${l10n.t('Open in Editor')} title=${l10n.t('Open in Editor')}
        class=${classMap({ hidden: history.selectedSha === null })}
        @click=${() => { if (history.selectedSha) { post({ type: 'pathHistoryOpenInEditor', sha: history.selectedSha }); } }}
      ></vscode-toolbar-button>`, modal.extras);
    render(nothing, modal.notes);
    render(html`<div class="history-detail blame-detail">${toolbar.element}${diff}</div>`, modal.body);
    // Stepping close to the oldest commit loaded asks for more.
    if (history.hasMore && !history.loadingMore && index >= history.commits.length - 5) {
      history.loadingMore = true;
      post({ type: 'pathHistoryLoadMore' });
    }
  }

  /** Draws the header controls, the summary line and the body: the commit list and the diff beside it. */
  function paint(): void {
    const now = new Date();
    if (options.blame) {
      paintBlame(now);
      return;
    }
    const scrollTop = list()?.scrollTop ?? 0;
    render(html`
      <span class="history-path" title=${history.path}>${history.path}</span>
      <span class="history-header-spacer"></span>
      <div class="history-options">
        <vscode-checkbox-group>
          <vscode-checkbox class=${classMap({ 'history-option': true, hidden: !history.canFollow })}
            label=${l10n.t('Follow renames')} .checked=${live(history.follow)}
            @change=${() => post({ type: 'pathHistoryToggle', option: 'follow' })}></vscode-checkbox>
          <vscode-checkbox class="history-option" label=${l10n.t('Include merges')} .checked=${live(history.merges)}
            @change=${() => post({ type: 'pathHistoryToggle', option: 'merges' })}></vscode-checkbox>
        </vscode-checkbox-group>
        <vscode-button type="button" secondary class=${classMap({ 'history-reset': true, hidden: history.scope !== 'file' })}
          ?disabled=${history.selectedSha === null} @click=${() => post({ type: 'pathHistoryReset' })}
        >${l10n.t('Reset File to This Version…')}</vscode-button>
      </div>`, modal.extras);
    render(html`<div class="history-status">${history.summary}</div>`, modal.notes);
    render(html`
      <div class="history-list" tabindex="0" role="listbox" aria-label=${l10n.t('Commits')}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            move(event.key === 'ArrowDown' ? 1 : -1);
          } else if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            move(event.key === 'Home' ? -history.commits.length : history.commits.length);
          }
        }}
        @scroll=${(event: Event) => {
          const element = event.currentTarget as HTMLElement;
          const remaining = element.scrollHeight - element.scrollTop - element.clientHeight;
          if (history.hasMore && !history.loadingMore && remaining < LOAD_MORE_THRESHOLD_PX) {
            history.loadingMore = true;
            post({ type: 'pathHistoryLoadMore' });
          }
        }}>
        ${repeat(history.commits, (commit) => commit.sha, (commit) => rowTemplate(commit, now))}
      </div>
      <div class="history-detail">${toolbar.element}${diff}</div>`, modal.body);
    const element = list();
    if (element) { element.scrollTop = scrollTop; }
  }

  paint();

  return {
    setViewOptions(next): void {
      viewOptions = options.blame ? { ...next, sideBySide: false } : { ...next };
      viewer.setOptions(viewOptions);
      toolbar.setOptions(viewOptions);
    },
    applyHostMessage(message): void {
      switch (message.type) {
        case 'pathHistoryOpen':
          Object.assign(history, {
            commits: [], selectedSha: null, hasMore: false, loadingMore: false,
            path: message.path, scope: message.scope, canFollow: message.canFollow,
          });
          renderedSha = null;
          wantedSha = message.select ?? null;
          Object.assign(blame, { shas: [], commits: {}, lines: [] });
          viewer.setLineLead(undefined);
          if (options.blame) {
            viewer.showMessage(l10n.t('Select a commit to see its change.'));
            paint();
            if (!modal.isOpen()) { modal.show(); }
            return;
          }
          modal.title.textContent = message.scope === 'file' ? l10n.t('History') : message.scope === 'directory' ? l10n.t('Folder History') : l10n.t('Hunk History');
          viewer.showMessage(l10n.t('Select a commit to see its change.'));
          paint();
          if (!modal.isOpen()) {
            modal.show();
            list()?.focus();
          }
          return;
        case 'pathHistoryMeta':
          Object.assign(history, {
            summary: message.summary, github: message.github, follow: message.follow, merges: message.includeMerges,
          });
          paint();
          return;
        case 'pathHistoryPage':
          history.loadingMore = false;
          history.hasMore = message.page.hasMore;
          if (message.append) {
            const known = new Set(history.commits.map((commit) => commit.sha));
            history.commits = history.commits.concat(message.page.commits.filter((commit) => !known.has(commit.sha)));
          } else {
            history.commits = message.page.commits;
            history.selectedSha = null;
            renderedSha = null;
            const element = list();
            if (element) { element.scrollTop = 0; }
          }
          paint();
          if (wantedSha && history.commits.some((commit) => commit.sha === wantedSha)) {
            const wanted = wantedSha;
            wantedSha = null;
            select(wanted);
            list()?.querySelector<HTMLElement>(`[data-sha="${wanted}"]`)?.scrollIntoView({ block: 'nearest' });
          } else if (wantedSha && message.page.hasMore) {
            // The host keeps loading pages until the commit it wants is in the list.
          } else if ((!message.append || wantedSha) && history.commits[0]) {
            // Either the first page, or the commit that was wanted is not in the file's history after all.
            wantedSha = null;
            select(history.commits[0].sha);
          } else if (history.commits.length === 0) {
            viewer.showMessage(l10n.t('No commits.'));
          }
          return;
        case 'pathHistoryBlame':
          if (message.sha === history.selectedSha) {
            Object.assign(blame, { shas: message.shas, commits: message.commits });
            viewer.setLineLead(blameGutter({
              shas: blame.shas, commits: blame.commits, github: history.github,
              isListed: (sha) => history.commits.some((commit) => commit.sha === sha),
              selectedSha: history.selectedSha, lineOf: (index) => blame.lines[index]?.line,
            }, {
              select, openLink: (url) => post({ type: 'openGitHubLink', url }),
              stepBack: (line) => { if (history.selectedSha) { post({ type: 'pathHistoryBlameBefore', sha: history.selectedSha, line }); } },
            }));
          }
          return;
        case 'pathHistoryDiff':
          if (message.sha !== history.selectedSha) {
            return;
          }
          if (options.blame) {
            // The blame for these lines arrives after the diff.
            Object.assign(blame, { shas: [], commits: {}, lines: message.lines });
            viewer.setLineLead(undefined);
          }
          if (message.error) {
            viewer.showMessage(l10n.t('Could not load this diff: {0}', message.error), true);
          } else if (message.nonText) {
            viewer.showMessage('');
            renderNonTextDiff(diff, message.nonText, DEFAULT_WORKING_COPY_DIFF_VIEW_OPTIONS, () => undefined);
          } else {
            void viewer.showDiff(history.path, message.lines, message.binary, renderedSha === message.sha);
          }
          renderedSha = message.sha;
          return;
        case 'pathHistorySelectCommit':
          select(message.sha);
          list()?.querySelector<HTMLElement>(`[data-sha="${message.sha}"]`)?.scrollIntoView({ block: 'nearest' });
          return;
        case 'pathHistoryFailed':
          history.loadingMore = false;
          return;
        case 'pathHistoryClose':
          modal.hide();
          return;
      }
    },
  };
}
