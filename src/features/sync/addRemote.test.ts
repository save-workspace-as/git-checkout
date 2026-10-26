import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  addRemoteGitArgs,
  executeAddRemote,
  parseAddRemoteArg,
  parseRemoteNames,
  remoteTestFailureMessage,
  remoteTestGitArgs,
  testRemoteUrl,
  validateRemoteName,
  validateRemoteUrl,
} from './addRemote';
import type { GitCli } from '../../core/gitCli';
import { GitCliError } from '../../core/gitCliError';
import { mockGitCli } from '../../core/testing/serviceTestUtils';

describe('validateRemoteName', () => {
  it('requires a safe unused name', () => {
    assert.equal(validateRemoteName('  '), 'Name is required');
    assert.equal(validateRemoteName('--force'), 'Enter a remote name without spaces or options');
    assert.equal(validateRemoteName('my remote'), 'Enter a remote name without spaces or options');
    assert.equal(validateRemoteName('origin', ['origin']), 'Remote already exists');
    assert.equal(validateRemoteName(' contrib ', ['origin']), undefined);
  });
});

describe('validateRemoteUrl', () => {
  it('accepts Git URL forms and rejects options', () => {
    assert.equal(validateRemoteUrl('  '), 'URL is required');
    assert.equal(validateRemoteUrl('--upload-pack=evil'), 'Enter a remote URL without spaces or options');
    assert.equal(validateRemoteUrl('not a url'), 'Enter a remote URL without spaces or options');
    assert.equal(validateRemoteUrl('example.com/repo.git'), 'Enter a Git remote URL');
    assert.equal(validateRemoteUrl('https://example.com/repo.git'), undefined);
    assert.equal(validateRemoteUrl('git@github.com:org/repo.git'), undefined);
    assert.equal(validateRemoteUrl('ssh://git@github.com/org/repo.git'), undefined);
    assert.equal(validateRemoteUrl('/srv/git/repo.git'), undefined);
    assert.equal(validateRemoteUrl('../other.git'), undefined);
  });
});

describe('add remote git args', () => {
  it('adds a remote after end of options', () => {
    assert.deepEqual(
      addRemoteGitArgs({ name: ' contrib ', url: ' https://example.com/repo.git ' }),
      ['remote', 'add', '--', 'contrib', 'https://example.com/repo.git'],
    );
    assert.deepEqual(remoteTestGitArgs('git@github.com:org/repo.git'), [
      'ls-remote',
      '--',
      'git@github.com:org/repo.git',
    ]);
    assert.throws(() => addRemoteGitArgs({ name: '--force', url: 'https://example.com/repo.git' }));
    assert.throws(() => remoteTestGitArgs('-'));
  });

  it('parses remote names', () => {
    assert.deepEqual(parseRemoteNames('origin\nupstream\norigin\n'), ['origin', 'upstream']);
    assert.deepEqual(parseRemoteNames(''), []);
  });
});

describe('parseAddRemoteArg', () => {
  it('ignores sidebar nodes and accepts a name and URL', () => {
    assert.deepEqual(parseAddRemoteArg(undefined), { status: 'absent' });
    assert.deepEqual(parseAddRemoteArg({ kind: 'section', label: 'Remotes' }), { status: 'absent' });
    assert.deepEqual(parseAddRemoteArg({ name: ' contrib ', url: ' https://example.com/repo.git ' }), {
      status: 'ready',
      request: { name: 'contrib', url: 'https://example.com/repo.git' },
    });
    assert.equal(parseAddRemoteArg({ name: 'contrib' }).status, 'invalid');
    assert.equal(parseAddRemoteArg({ url: 'https://example.com/repo.git' }).status, 'invalid');
    assert.equal(parseAddRemoteArg({ name: '--force', url: 'https://example.com/repo.git' }).status, 'invalid');
    assert.equal(parseAddRemoteArg({ name: 'contrib', url: 'not a url' }).status, 'invalid');
  });
});

describe('remoteTestFailureMessage', () => {
  it('maps reachability failures without echoing git output', () => {
    assert.equal(remoteTestFailureMessage('fatal: Authentication failed', false), 'The remote requires authentication');
    assert.equal(
      remoteTestFailureMessage("fatal: '/tmp/missing' does not appear to be a git repository", false),
      'The remote repository was not found',
    );
    assert.equal(remoteTestFailureMessage('', true), 'The remote did not respond in time');
    assert.equal(remoteTestFailureMessage('fatal: something else', false), 'Could not reach the remote URL');
  });
});

describe('testRemoteUrl', () => {
  it('asks git to reach the URL with prompts disabled', async () => {
    let options: { network?: boolean; timeoutMs?: number } | undefined;
    const cli = {
      execRead: async (_args: string[], opts?: { network?: boolean; timeoutMs?: number }) => {
        options = opts;
        return { stdout: '' };
      },
    } as unknown as GitCli;
    assert.equal(await testRemoteUrl(cli, ' https://example.com/repo.git '), undefined);
    assert.equal(options?.network, true);
    assert.equal(options?.timeoutMs, 15_000);
  });

  it('returns a validation or reachability message', async () => {
    const { cli } = mockGitCli({
      execRead: async () => {
        throw new GitCliError('ExitCode', 'failed', '/repo', 'fatal: Authentication failed', 128);
      },
    });
    assert.equal(await testRemoteUrl(cli, '  '), 'URL is required');
    assert.equal(
      await testRemoteUrl(cli, 'https://example.com/repo.git'),
      'The remote requires authentication',
    );
  });
});

describe('executeAddRemote', () => {
  it('writes git remote add when the name is free', async () => {
    const { cli, reads, writes } = mockGitCli({
      execRead: async () => ({ stdout: 'origin\n' }),
    });
    await executeAddRemote(cli, { name: 'contrib', url: 'https://example.com/repo.git' });
    assert.deepEqual(reads, [['remote']]);
    assert.deepEqual(writes, [['remote', 'add', '--', 'contrib', 'https://example.com/repo.git']]);
  });

  it('refuses a name that is already configured', async () => {
    const { cli, writes } = mockGitCli({
      execRead: async () => ({ stdout: 'origin\n' }),
    });
    await assert.rejects(
      () => executeAddRemote(cli, { name: 'origin', url: 'https://example.com/repo.git' }),
      /Remote already exists/,
    );
    assert.deepEqual(writes, []);
  });
});
