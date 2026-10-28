import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import { editorTokenColorsFromRules } from '../src/shared/diff/editorTokenColors';
import type { HostMessage, WebviewMessage } from './protocol';
import { installDom } from './testing/dom';

// An entry script runs when it is imported: it finds #root, asks VS Code for its API and listens for messages.
const sent: WebviewMessage[] = [];
const receive = (message: HostMessage): boolean => window.dispatchEvent(new MessageEvent('message', { data: message }));
/** Waits for the highlighter, which loads its grammar asynchronously and takes longer on a cold start. */
const highlighted = async (): Promise<void> => {
  for (let tries = 0; tries < 200 && !document.querySelector('code .hljs-keyword'); tries++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};
type El = HTMLElement & Record<string, any>;

before(async () => {
  installDom();
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  (globalThis as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi = () => ({
    postMessage: (message: WebviewMessage) => sent.push(message),
  });
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  await import('./treeMain');
});

describe('Tree tab wiring', () => {
  it('says when the Preview is ready', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ type: 'treeViewReady' }]);
  });

  it('shows the picked file in the Preview view, themed, and clears it when the revision changes', async () => {
    const viewer = document.querySelector('.code-viewer') as El;
    assert.equal(viewer.textContent, 'Select a file to preview it.');
    receive({
      type: 'commitTreeFilePreview',
      preview: { revision: 'abc123', path: 'app.ts', text: 'export const value = 1;\n' },
    });
    await highlighted();
    assert.match(document.querySelector('code')?.innerHTML ?? '', /hljs-keyword/);
    const colors = { ...editorTokenColorsFromRules([], undefined), keyword: '#123456' };
    receive({ type: 'editorTokenColors', colors });
    assert.equal(viewer.style.getPropertyValue('--commit-token-keyword'), colors.keyword);
    receive({ type: 'commitTreePreviewClear' });
    assert.equal(viewer.textContent, 'Select a file to preview it.');
    receive({ type: 'commitTreeFilePreview', preview: { revision: 'abc123', path: 'empty.ts', text: '' } });
    assert.equal(viewer.textContent, 'Empty file.');
  });

  it('draws a picture with its size, frees it, and shows text again for the next file', () => {
    const made: string[] = [];
    const freed: string[] = [];
    const realCreate = URL.createObjectURL;
    const realRevoke = URL.revokeObjectURL;
    URL.createObjectURL = () => {
      made.push(`blob:image-${made.length}`);
      return made[made.length - 1];
    };
    URL.revokeObjectURL = (url: string) => {
      freed.push(url);
    };
    try {
      const codeHost = document.querySelector('.commit-tree-preview') as El;
      const imageHost = document.querySelector('.commit-tree-image') as El;
      receive({
        type: 'commitTreeFilePreview',
        preview: {
          revision: 'abc123',
          path: 'img/logo.png',
          text: '',
          image: { mimeType: 'image/png', byteLength: 275_456, dataBase64: 'iVBORw0KGgo=' },
        },
      });
      assert.equal(imageHost.hidden, false);
      assert.equal(codeHost.hidden, true);
      const image = imageHost.querySelector('img') as El;
      assert.equal(image.getAttribute('src'), 'blob:image-0');
      assert.equal(image.getAttribute('alt'), 'logo.png');
      const meta = imageHost.querySelector('.wd-image-meta') as El;
      assert.equal(meta.textContent, '269 KB');
      Object.defineProperty(image, 'naturalWidth', { value: 1024 });
      Object.defineProperty(image, 'naturalHeight', { value: 512 });
      image.dispatchEvent(new Event('load'));
      assert.equal(meta.textContent, 'W: 1024px | H: 512px (269 KB)');

      receive({ type: 'commitTreeFilePreview', preview: { revision: 'abc123', path: 'notes.txt', text: 'plain\n' } });
      assert.equal(imageHost.hidden, true);
      assert.equal(codeHost.hidden, false);
      assert.deepEqual(freed, ['blob:image-0']);
      assert.equal(imageHost.querySelector('img'), null);
    } finally {
      URL.createObjectURL = realCreate;
      URL.revokeObjectURL = realRevoke;
    }
  });

  it('says why a picture cannot be previewed instead of drawing it', () => {
    receive({
      type: 'commitTreeFilePreview',
      preview: { revision: 'abc123', path: 'big.png', text: '', error: 'This image is too large to preview (9 MB).' },
    });
    assert.equal((document.querySelector('.commit-tree-image') as El).hidden, true);
    assert.equal((document.querySelector('.code-viewer') as El).textContent, 'This image is too large to preview (9 MB).');
  });
});
