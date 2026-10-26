import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Uri } from 'vscode';
import {
  buildGitCheckoutBlobQuery,
  buildGitCheckoutBlobUri,
  gitShowObjectSpec,
  parseGitCheckoutBlobUri,
} from './gitCheckoutUri';

describe('gitCheckoutUri', () => {
  it('round-trips blob location via query params', () => {
    const query = buildGitCheckoutBlobQuery('/repo/root', 'abc123', 'src/foo.ts');
    const uri = { scheme: 'git-checkout', query, authority: '', path: '/', fragment: '' } as Uri;
    const parsed = parseGitCheckoutBlobUri(uri);
    assert.deepEqual(parsed, {
      repoRoot: '/repo/root',
      revision: 'abc123',
      path: 'src/foo.ts',
    });
  });

  it('keeps the file name in the path so the editor can highlight it', () => {
    assert.match(buildGitCheckoutBlobUri('/repo', 'HEAD', 'src/a.txt'), /^git-checkout:\/src\/a\.txt\?/);
  });

  it('builds git show object specs', () => {
    assert.equal(gitShowObjectSpec('HEAD', 'a/b.txt'), 'HEAD:a/b.txt');
    assert.equal(gitShowObjectSpec(':', 'a/b.txt'), ':a/b.txt');
  });
});
