import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { preferredStartRef } from './startRef';

describe('preferredStartRef', () => {
  it('prefers the checked-out branch, then a local branch, a remote branch and a tag', () => {
    assert.equal(
      preferredStartRef([
        { kind: 'tag', name: 'v1' }, { kind: 'remote', name: 'origin/main' },
        { kind: 'local', name: 'topic' }, { kind: 'local', name: 'main', isHead: true },
      ]),
      'main',
    );
    assert.equal(preferredStartRef([{ kind: 'tag', name: 'v1' }, { kind: 'local', name: 'topic' }]), 'topic');
    assert.equal(preferredStartRef([{ kind: 'tag', name: 'v1' }, { kind: 'remote', name: 'origin/dev' }]), 'origin/dev');
    assert.equal(preferredStartRef([{ kind: 'tag', name: 'v1' }]), 'v1');
  });

  it('has no name for a commit that is only a detached HEAD, a stash or has no refs', () => {
    assert.equal(preferredStartRef([]), undefined);
    assert.equal(preferredStartRef([{ kind: 'head', name: 'HEAD' }, { kind: 'stash', name: 'stash' }]), undefined);
  });
});
