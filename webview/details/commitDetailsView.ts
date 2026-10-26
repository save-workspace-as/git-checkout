import * as l10n from '@vscode/l10n';
import { html, render } from 'lit';
import { DEFAULT_WORKING_COPY_DIFF_VIEW_OPTIONS } from '../../src/shared/diff/diffViewOptions';
import { mountCodeViewer } from './codeViewer';
import { renderNonTextDiff } from './nonTextDiffView';
import type { CommitDetailsHostMessage, GraphCommitDto, WebviewMessage } from '../protocol';

function diffKey(message: { sha: string; baseSha?: string; path: string }): string {
  return `${message.baseSha ?? ''}\0${message.sha}\0${message.path}`;
}

/** The selected file's diff. The commit summary and file list live in the native Changes tree. */
export function mountCommitDetailsView(
  container: HTMLElement,
  postMessage: (message: WebviewMessage) => void,
): {
  showCommit(commit: GraphCommitDto): void;
  /** Shows the changes from `base` (older) to `commit`. */
  showCompare(base: GraphCommitDto, commit: GraphCommitDto): void;
  applyHostMessage(message: CommitDetailsHostMessage): void;
} {
  container.classList.add('commit-details');
  render(html`<div class="commit-file-diff"></div>`, container);
  const diff = container.querySelector<HTMLElement>('.commit-file-diff')!;
  const viewer = mountCodeViewer(diff);

  let shownSha: string | null = null;
  let shownBase: string | null = null;
  let selectedPath: string | null = null;
  /** Which file's diff is on screen, so a re-read of it (a view option changed) keeps the scroll position. */
  let renderedKey: string | null = null;

  function show(sha: string, base: string | null): void {
    shownSha = sha;
    shownBase = base;
    selectedPath = null;
    renderedKey = null;
    viewer.showMessage(l10n.t('Loading…'));
  }

  viewer.showMessage(l10n.t('Select a commit in the graph.'));

  return {
    showCommit(next: GraphCommitDto): void {
      show(next.sha, null);
    },
    showCompare(base: GraphCommitDto, head: GraphCommitDto): void {
      show(head.sha, base.sha);
    },
    applyHostMessage(message: CommitDetailsHostMessage): void {
      switch (message.type) {
        case 'editorTokenColors':
          viewer.setTokenColors(message.colors);
          return;
        case 'commitDiffView':
          viewer.setOptions(message.options);
          return;
        case 'commitDiffNavigate':
          viewer.navigate(message.direction);
          return;
        case 'commitDetailsShowFile':
          if (message.sha === shownSha && (message.baseSha ?? null) === shownBase) {
            selectedPath = message.path;
            if (renderedKey !== diffKey(message)) {
              renderedKey = null;
              viewer.showMessage(l10n.t('Loading diff…'));
            }
          }
          return;
        case 'commitDetailsFileDiff':
          if (
            message.sha === shownSha &&
            (message.baseSha ?? null) === shownBase &&
            message.path === selectedPath
          ) {
            const key = diffKey(message);
            const keepScroll = renderedKey === key;
            renderedKey = key;
            if (message.error) {
              viewer.showMessage(l10n.t('Could not load this diff: {0}', message.error), true);
            } else if (message.nonText) {
              viewer.showMessage('');
              renderNonTextDiff(diff, message.nonText, DEFAULT_WORKING_COPY_DIFF_VIEW_OPTIONS, () => undefined);
            } else {
              void viewer.showDiff(message.path, message.lines, message.binary, keepScroll);
            }
          }
          return;
        case 'commitDetails':
          if (message.details.sha === shownSha && (message.details.baseSha ?? null) === shownBase) {
            if (message.details.files.length === 0) {
              selectedPath = null;
              viewer.showMessage(l10n.t('No changed files.'));
            }
          }
          return;
        default:
          return;
      }
    },
  };
}
