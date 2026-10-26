import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { GRAVATAR_ORIGIN } from '../core/gravatar';
import { GITHUB_AVATAR_ORIGIN } from '../features/graph/githubAvatars';
import { webviewImgSrc } from './webviewImgSrc';

describe('webviewImgSrc', () => {
  it('allows the extension, image diffs, and GitHub pictures', () => {
    const src = webviewImgSrc('vscode-webview:', false);
    assert.equal(src.includes('vscode-webview:'), true);
    assert.equal(src.includes('blob:'), true);
    assert.equal(src.includes(GITHUB_AVATAR_ORIGIN), true);
    assert.equal(src.includes(GRAVATAR_ORIGIN), false);
  });

  it('allows Gravatar when that setting is on', () => {
    assert.equal(webviewImgSrc('vscode-webview:', true).includes(GRAVATAR_ORIGIN), true);
  });
});
