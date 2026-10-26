import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { RepositoryNotOpenError } from './repositoryNotOpenError';

describe('RepositoryNotOpenError', () => {
  it('is an Error that callers can tell apart from a failed Git command', () => {
    const error = new RepositoryNotOpenError();
    assert.ok(error instanceof Error);
    assert.ok(error instanceof RepositoryNotOpenError);
    assert.equal(error.message, 'Repository is not open.');
  });
});
