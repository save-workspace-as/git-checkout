import type { CommitDiffViewOptions } from '../../src/shared/diff/commitDiffPresentation';
import type { EditorTokenColors } from '../../src/shared/diff/editorTokenColors';
import type { CommitTreeImageDto } from '../../src/shared/history/commitTreeProtocol';
import * as l10n from '@vscode/l10n';
import { html, render } from 'lit';
import type { CommitTreeHostMessage, WebviewMessage } from '../protocol';
import { mountCodeViewer } from './codeViewer';
import { base64ToBytes, imageFrameTemplate } from './nonTextDiffView';

/** The Tree tab's Preview view: the file picked in the Files list, as it was at the shown revision. */
export function mountCommitTreePreview(
  container: HTMLElement,
  postMessage: (message: WebviewMessage) => void,
): {
  applyHostMessage(message: CommitTreeHostMessage): void;
  setTokenColors(colors: EditorTokenColors): void;
  setViewOptions(options: CommitDiffViewOptions): void;
} {
  render(html`<div class="commit-file-diff commit-tree-preview"></div><div class="commit-tree-image" hidden></div>`, container);
  const codeHost = container.querySelector<HTMLElement>('.commit-tree-preview')!;
  const imageHost = container.querySelector<HTMLElement>('.commit-tree-image')!;
  const viewer = mountCodeViewer(codeHost);
  viewer.showMessage(l10n.t('Select a file to preview it.'));
  let imageUrl: string | undefined;

  /** Shows the code viewer, or the picture in its place, and frees the previous picture. */
  const show = (picture: boolean): void => {
    codeHost.hidden = picture;
    imageHost.hidden = !picture;
    if (!picture && imageUrl) {
      URL.revokeObjectURL(imageUrl);
      imageUrl = undefined;
      render(html``, imageHost);
    }
  };

  const showImage = (path: string, image: CommitTreeImageDto): void => {
    if (imageUrl) {
      URL.revokeObjectURL(imageUrl);
    }
    imageUrl = URL.createObjectURL(new Blob([Uint8Array.from(base64ToBytes(image.dataBase64))], { type: image.mimeType }));
    render(imageFrameTemplate(imageUrl, path.slice(path.lastIndexOf('/') + 1), image.byteLength), imageHost);
    show(true);
  };

  return {
    setTokenColors: viewer.setTokenColors,
    setViewOptions(options: CommitDiffViewOptions): void {
      viewer.setOptions(options);
    },
    applyHostMessage(message: CommitTreeHostMessage): void {
      if (message.type === 'commitTreePreviewClear') {
        show(false);
        viewer.showMessage(l10n.t('Select a file to preview it.'));
      } else if (message.type === 'commitTreeFilePreview') {
        const { preview } = message;
        if (preview.image && !preview.error) {
          showImage(preview.path, preview.image);
          return;
        }
        show(false);
        if (preview.error) {
          viewer.showMessage(preview.error, true);
        } else {
          void viewer.showFile(preview.path, preview.text);
        }
      }
    },
  };
}
