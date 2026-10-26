import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  fetchCliArgs,
  initialFetchChoices,
  loadFetchCatalog,
  parseFetchCommandArg,
  type FetchCatalog,
} from './fetchOptions';

const catalog: FetchCatalog = {
  remotes: ['origin', 'upstream'],
  upstreamRemote: 'upstream',
};

describe('fetch options', () => {
  it('fetches one remote or every remote', () => {
    assert.deepEqual(fetchCliArgs({ remote: 'origin', all: false }), ['fetch', '--', 'origin']);
    assert.deepEqual(fetchCliArgs({ remote: 'origin', all: true }), ['fetch', '--all']);
    assert.throws(() => fetchCliArgs({ remote: '--all', all: false }));
    assert.throws(() => fetchCliArgs({ remote: '', all: false }));
  });

  it('defaults to the upstream remote', () => {
    assert.deepEqual(initialFetchChoices(catalog), { remote: 'upstream', all: false });
    assert.deepEqual(initialFetchChoices({ remotes: ['contrib', 'origin'], upstreamRemote: null }), {
      remote: 'origin',
      all: false,
    });
    assert.deepEqual(initialFetchChoices({ remotes: [], upstreamRemote: null }), {
      remote: '',
      all: false,
    });
  });

  it('parses a command argument for one remote or all remotes', () => {
    assert.deepEqual(parseFetchCommandArg({ remote: ' origin ', all: false }), {
      remote: 'origin',
      all: false,
    });
    assert.deepEqual(parseFetchCommandArg({ all: true }), { remote: '', all: true });
    assert.deepEqual(parseFetchCommandArg({ remote: 'upstream', all: true }), {
      remote: 'upstream',
      all: true,
    });
    assert.equal(parseFetchCommandArg({ remote: '--force' }), undefined);
    assert.equal(parseFetchCommandArg({ all: true, remote: '--force' }), undefined);
    assert.equal(parseFetchCommandArg({ label: 'origin' }), undefined);
    assert.equal(parseFetchCommandArg(null), undefined);
  });

  it('loads remote names and the upstream remote', async () => {
    const loaded = await loadFetchCatalog(
      {
        execRead: async () => ({ stdout: 'origin\nupstream\norigin\n' }),
      },
      'upstream/main',
    );
    assert.deepEqual(loaded, { remotes: ['origin', 'upstream'], upstreamRemote: 'upstream' });
  });
});
