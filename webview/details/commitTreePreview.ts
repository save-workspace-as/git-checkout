import type { CommitDiffViewOptions } from '../../src/shared/diff/commitDiffPresentation';
import type { EditorTokenColors } from '../../src/shared/diff/editorTokenColors';
import * as l10n from '@vscode/l10n';
import { html, render } from 'lit';
import type { CommitTreeHostMessage, WebviewMessage } from '../protocol';
import { mountCodeViewer } from './codeViewer';

/** The Tree tab's Preview view: the file picked in the Files list, as it was at the shown revision. */
export function mountCommitTreePreview(
  container: HTMLElement,
  postMessage: (message: WebviewMessage) => void,
): {
  applyHostMessage(message: CommitTreeHostMessage): void;
  setTokenColors(colors: EditorTokenColors): void;
  setViewOptions(options: CommitDiffViewOptions): void;
} {
  render(html`<div class="commit-file-diff commit-tree-preview"></div>`, container);
  const viewer = mountCodeViewer(container.querySelector<HTMLElement>('.commit-tree-preview')!);
  viewer.showMessage(l10n.t('Select a file to preview it.'));

  return {
    setTokenColors: viewer.setTokenColors,
    setViewOptions(options: CommitDiffViewOptions): void {
      viewer.setOptions(options);
    },
    applyHostMessage(message: CommitTreeHostMessage): void {
      if (message.type === 'commitTreePreviewClear') {
        viewer.showMessage(l10n.t('Select a file to preview it.'));
      } else if (message.type === 'commitTreeFilePreview') {
        if (message.preview.error) {
          viewer.showMessage(message.preview.error, true);
        } else {
          void viewer.showFile(message.preview.path, message.preview.text);
        }
      }
    },
  };
}
