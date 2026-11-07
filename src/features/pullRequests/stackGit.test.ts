import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { pushStackArgs, pushStackForm, rebaseStackForm, stackLinkFor, validatePushStackForm } from './stackGit';

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
    assert.equal(pushStackForm(['a'], ['origin'], 'origin').fields[0].description, 'Push the branch a.');
    assert.deepEqual(validatePushStackForm(['origin'], { remote: 'origin' }), {});
    assert.ok(validatePushStackForm(['origin'], { remote: 'nope' }).remote);
  });
});

describe('rebaseStackForm', () => {
  it('names the layers and the trunk, and fetches first unless told not to', () => {
    const form = rebaseStackForm(['a', 'b', 'c'], 'origin/main');
    assert.deepEqual(form.values, { stack: 'a → b → c', fetch: true });
    assert.match(form.fields[0].description ?? '', /the first onto origin\/main/);
    assert.equal(form.fields[0].type === 'text' && form.fields[0].readOnly, true);
  });
});

describe('stackLinkFor', () => {
  const stack = (number: number, pullRequests: number[], open = true) => ({ number, open, pullRequests });

  it('creates a stack when none of the pull requests is in one', () => {
    assert.deepEqual(stackLinkFor([], [1, 2, 3]), { kind: 'create', pullRequests: [1, 2, 3] });
    assert.deepEqual(stackLinkFor([stack(9, [7, 8])], [1, 2]), { kind: 'create', pullRequests: [1, 2] });
  });

  it('does not count a stack that is closed', () => {
    assert.deepEqual(stackLinkFor([stack(4, [1, 2], false)], [1, 2]), { kind: 'create', pullRequests: [1, 2] });
  });

  it('leaves a stack that has all of them in order', () => {
    assert.deepEqual(stackLinkFor([stack(4, [1, 2, 3])], [1, 2, 3]), { kind: 'linked' });
  });

  it('adds the pull requests above the ones a stack has', () => {
    assert.deepEqual(stackLinkFor([stack(4, [1, 2])], [1, 2, 3, 4]), { kind: 'add', stack: 4, pullRequests: [3, 4] });
  });

  it('leaves the people to settle it when the stack and the branches disagree', () => {
    assert.deepEqual(stackLinkFor([stack(4, [2, 1])], [1, 2]), { kind: 'differs', stack: 4 });
    assert.deepEqual(stackLinkFor([stack(4, [1]), stack(5, [2])], [1, 2]), { kind: 'differs', stack: 4 });
    assert.deepEqual(stackLinkFor([stack(4, [1, 9])], [1, 2]), { kind: 'differs', stack: 4 });
    assert.deepEqual(stackLinkFor([stack(4, [2, 3])], [1, 2, 3]), { kind: 'differs', stack: 4 });
  });
});
