import { strict as assert } from 'node:assert';
import { before, describe, it } from 'node:test';
import { DEFAULT_COMMIT_DIFF_VIEW } from '../src/shared/diff/commitDiffPresentation';
import type { HostMessage, WebviewMessage } from './protocol';
import { installDom } from './testing/dom';

const sent: WebviewMessage[] = [];
const receive = (message: HostMessage): boolean => window.dispatchEvent(new MessageEvent('message', { data: message }));
/** Waits for the highlighter, which loads its grammar asynchronously and takes longer on a cold start. */
const highlighted = async (): Promise<void> => {
  for (let tries = 0; tries < 200 && !document.querySelector('code .hljs-keyword'); tries++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

before(async () => {
  installDom();
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
  (Element.prototype as unknown as { scrollIntoView(): void }).scrollIntoView = function scroll(this: Element & { scrolled?: boolean }) {
    this.scrolled = true;
  };
  (globalThis as unknown as { acquireVsCodeApi: unknown }).acquireVsCodeApi = () => ({
    postMessage: (message: WebviewMessage) => sent.push(message),
    getState: () => undefined,
    setState: () => undefined,
  });
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
  await import('./commitMain');
});

describe('Commit tab code-viewer wiring', () => {
  it('renders the selected diff in the shared viewer and responds to view options', async () => {
    receive({
      type: 'commitDetailsPreview',
      commit: {
        sha: 'abc123', parents: [], subject: 'Example commit', author: 'Author',
        authorEmail: 'author@example.com', authorDate: 0, refs: [],
      },
    } as HostMessage);
    receive({
      type: 'commitDetails',
      details: {
        sha: 'abc123', body: '', committer: { name: '', email: '', date: 0 },
        files: [{ path: 'app.ts', status: 'M' }],
      },
    } as HostMessage);
    receive({ type: 'commitDetailsShowFile', sha: 'abc123', path: 'app.ts' } as HostMessage);
    receive({
      type: 'commitDetailsFileDiff', sha: 'abc123', path: 'app.ts', binary: false,
      lines: [
        { kind: 'del', text: 'const before = 1;', line: 1 },
        { kind: 'add', text: 'const after = 2;', line: 1 },
      ],
    } as HostMessage);
    await highlighted();
    const viewer = document.querySelector('.code-viewer')!;
    assert.match(viewer.querySelector('code')?.innerHTML ?? '', /hljs-keyword/);
    receive({ type: 'commitDiffView', options: { ...DEFAULT_COMMIT_DIFF_VIEW, sideBySide: true } });
    assert.equal(viewer.querySelectorAll('.commit-diff-pair').length, 1);
    receive({ type: 'commitDiffNavigate', direction: 'next' });
    assert.equal((viewer.querySelector('.commit-diff-pair') as Element & { scrolled?: boolean }).scrolled, true);
    assert.equal(sent.at(0)?.type, 'commitViewReady');
  });
});
