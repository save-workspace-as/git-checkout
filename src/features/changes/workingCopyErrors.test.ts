import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { GitCliError } from '../../core/gitCliError';
import { mapWorkingCopyFailure } from './workingCopyErrors';

describe('mapWorkingCopyFailure', () => {
  it('maps permission, lock, and conflict failures', () => {
    assert.match(mapWorkingCopyFailure(new Error('EACCES: permission denied')), /not writable/);
    assert.match(
      mapWorkingCopyFailure(new GitCliError('ExitCode', 'failed', '/repo', 'Unable to create index.lock')),
      /lock the index/,
    );
    assert.match(
      mapWorkingCopyFailure(new GitCliError('ExitCode', 'failed', '/repo', 'needs merge')),
      /conflicts/,
    );
  });

  it('keeps other git messages', () => {
    assert.equal(mapWorkingCopyFailure(new Error('pathspec did not match')), 'pathspec did not match');
    assert.equal(
      mapWorkingCopyFailure(new GitCliError('Lock', 'busy', '/repo')),
      'Lock: busy',
    );
  });
});
