import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { pushStackArgs, pushStackForm, validatePushStackForm } from './stackGit';

describe('pushStackArgs', () => {
  it('pushes every branch in one atomic push, with a lease when forcing', () => {
    assert.deepEqual(pushStackArgs('origin', ['a', 'feat/b'], false), ['push', '--atomic', '--', 'origin', 'refs/heads/a:refs/heads/a', 'refs/heads/feat/b:refs/heads/feat/b']);
    assert.deepEqual(pushStackArgs('origin', ['a'], true).slice(0, 3), ['push', '--atomic', '--force-with-lease']);
  });

  it('refuses a remote or branch that Git would read as an option', () => {
    assert.throws(() => pushStackArgs('--mirror', ['a'], false));
    assert.throws(() => pushStackArgs('origin', ['-f'], false));
  });
});

describe('pushStackForm', () => {
  it('asks for the remote and whether to force, and names the branches', () => {
    const form = pushStackForm(['a', 'b'], ['origin', 'fork'], 'origin');
    assert.deepEqual(form.values, { remote: 'origin', force: true });
    assert.match(form.fields[0].description ?? '', /Push 2 branches in one push: a, b\./);
    assert.deepEqual(validatePushStackForm(['origin'], { remote: 'origin' }), {});
    assert.ok(validatePushStackForm(['origin'], { remote: 'nope' }).remote);
  });
});
