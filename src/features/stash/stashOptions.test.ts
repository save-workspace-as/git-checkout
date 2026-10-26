import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { parseStashCreateArg, stashAllRequest } from './stashOptions';

describe('stashAllRequest', () => {
  it('trims the message and records whether new files are included', () => {
    assert.deepEqual(stashAllRequest({ message: '  wip  ', includeNewFiles: false }), {
      mode: 'all',
      message: 'wip',
      includeUntracked: false,
    });
    assert.deepEqual(stashAllRequest({ message: '', includeNewFiles: true }), {
      mode: 'all',
      message: '',
      includeUntracked: true,
    });
  });
});

describe('parseStashCreateArg', () => {
  it('ignores sidebar nodes and accepts a command payload', () => {
    assert.deepEqual(parseStashCreateArg(undefined), { status: 'absent' });
    assert.deepEqual(parseStashCreateArg({ kind: 'section', label: 'Stashes' }), { status: 'absent' });
    assert.deepEqual(parseStashCreateArg({ message: ' wip ', includeNewFiles: false }), {
      status: 'ready',
      request: { mode: 'all', message: 'wip', includeUntracked: false },
    });
    assert.deepEqual(parseStashCreateArg({ message: 'take new', includeNewFiles: true }), {
      status: 'ready',
      request: { mode: 'all', message: 'take new', includeUntracked: true },
    });
  });

  it('defaults to leaving new files unstashed when the checkbox is omitted', () => {
    assert.deepEqual(parseStashCreateArg({ message: 'wip' }), {
      status: 'ready',
      request: { mode: 'all', message: 'wip', includeUntracked: false },
    });
  });

  it('rejects a payload that is not a stash message and checkbox', () => {
    assert.deepEqual(parseStashCreateArg({ includeNewFiles: true }), {
      status: 'invalid',
      message: 'Stash message must be text',
    });
    assert.deepEqual(parseStashCreateArg({ message: 'wip', includeNewFiles: 'yes' }), {
      status: 'invalid',
      message: 'Include newly created files must be true or false',
    });
  });
});
