import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import { editorTokenColorsFromRules } from '../src/shared/diff/editorTokenColors';
import type { HostMessage, WebviewMessage } from './protocol';
import { installDom } from './testing/dom';

// An entry script runs when it is imported: it finds #root, asks VS Code for its API and listens for messages.
const sent: WebviewMessage[] = [];
const receive = (message: HostMessage): boolean => window.dispatchEvent(new MessageEvent('message', { data: message }));
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
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
    await settle();
    assert.match(document.querySelector('code')?.innerHTML ?? '', /hljs-keyword/);
    const colors = { ...editorTokenColorsFromRules([], undefined), keyword: '#123456' };
    receive({ type: 'editorTokenColors', colors });
    assert.equal(viewer.style.getPropertyValue('--commit-token-keyword'), colors.keyword);
    receive({ type: 'commitTreePreviewClear' });
    assert.equal(viewer.textContent, 'Select a file to preview it.');
    receive({ type: 'commitTreeFilePreview', preview: { revision: 'abc123', path: 'empty.ts', text: '' } });
    assert.equal(viewer.textContent, 'Empty file.');
  });
});
