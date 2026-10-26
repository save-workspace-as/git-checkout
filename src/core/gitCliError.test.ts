import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { GitCliError, isGitLockError } from './gitCliError';

describe('GitCliError', () => {
  it('exposes code and stderr', () => {
    const err = new GitCliError('Lock', 'locked', '/repo', 'index.lock', 1);
    assert.equal(err.code, 'Lock');
    assert.equal(err.repoRoot, '/repo');
    assert.equal(err.stderr, 'index.lock');
    assert.equal(err.exitCode, 1);
    assert.equal(err.name, 'GitCliError');
  });
});

describe('isGitLockError', () => {
  it('detects common lock messages', () => {
    assert.equal(isGitLockError('fatal: Unable to create index.lock'), true);
    assert.equal(isGitLockError('shallow.lock file exists'), true);
    assert.equal(isGitLockError('unrelated error'), false);
  });
});
