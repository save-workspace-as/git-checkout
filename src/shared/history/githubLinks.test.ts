import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { branchUrl, commitUrl, fileUrl, repositoryUrl } from './githubLinks';

const repo = { host: 'github.com', owner: 'octo', repo: 'app' };

describe('GitHub links', () => {
  it('points at the repository, a commit and a branch', () => {
    assert.equal(repositoryUrl(repo), 'https://github.com/octo/app');
    assert.equal(commitUrl(repo, 'abc123'), 'https://github.com/octo/app/commit/abc123');
    assert.equal(branchUrl(repo, 'feat/line blame'), 'https://github.com/octo/app/tree/feat/line%20blame');
  });

  it('points at a file at a ref, with the lines picked out', () => {
    assert.equal(fileUrl(repo, 'main', 'src/app.ts'), 'https://github.com/octo/app/blob/main/src/app.ts');
    assert.equal(fileUrl(repo, 'abc', 'src/app.ts', { first: 7 }), 'https://github.com/octo/app/blob/abc/src/app.ts#L7');
    assert.equal(fileUrl(repo, 'abc', 'src/app.ts', { first: 7, last: 7 }), 'https://github.com/octo/app/blob/abc/src/app.ts#L7');
    assert.equal(fileUrl(repo, 'abc', 'src/app.ts', { first: 7, last: 12 }), 'https://github.com/octo/app/blob/abc/src/app.ts#L7-L12');
  });

  it('escapes what a path or a branch name can hold, and keeps its slashes', () => {
    assert.equal(fileUrl(repo, 'release/1.0', 'a b/c#d?.ts'), 'https://github.com/octo/app/blob/release/1.0/a%20b/c%23d%3F.ts');
    assert.equal(fileUrl(repo, 'main', '/leading//double.ts'), 'https://github.com/octo/app/blob/main/leading/double.ts');
    assert.equal(fileUrl({ host: 'ghe.example.com', owner: 'a b', repo: 'r' }, 'main', 'x'), 'https://ghe.example.com/a%20b/r/blob/main/x');
  });

  it('leaves a bad line out instead of writing a broken anchor', () => {
    assert.equal(fileUrl(repo, 'main', 'x', { first: 0 }), 'https://github.com/octo/app/blob/main/x');
    assert.equal(fileUrl(repo, 'main', 'x', { first: 5, last: 3 }), 'https://github.com/octo/app/blob/main/x#L5');
  });
});
