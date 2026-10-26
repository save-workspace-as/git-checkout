import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { GitCliError } from '../../core/gitCliError';
import {
  annotatedTagArgs,
  classifySigningFailure,
  formatSigningFailure,
  isGitConfigTrue,
  signingRemediation,
} from './signingDiagnostics';

describe('isGitConfigTrue', () => {
  it('accepts git truthy values', () => {
    for (const value of ['true', 'TRUE', '1', 'yes', 'on', ' true\n']) {
      assert.equal(isGitConfigTrue(value), true, value);
    }
  });

  it('rejects unset and false values', () => {
    for (const value of ['', 'false', '0', 'no', 'off']) {
      assert.equal(isGitConfigTrue(value), false, value);
    }
  });
});

describe('classifySigningFailure', () => {
  const cases: { text: string; problem: string | null }[] = [
    { text: 'error: gpg failed to sign the data\ngpg: skipped "ABC": No secret key', problem: 'no-key' },
    { text: 'gpg: signing failed: No pinentry', problem: 'pinentry' },
    { text: 'gpg: signing failed: Inappropriate ioctl for device', problem: 'pinentry' },
    { text: 'error: cannot run gpg: No such file or directory', problem: 'gpg-missing' },
    { text: 'error: gpg failed to sign the data\nfatal: failed to write commit object', problem: 'sign-failed' },
    { text: 'fatal: not a git repository', problem: null },
    { text: '', problem: null },
  ];

  for (const entry of cases) {
    it(`classifies ${JSON.stringify(entry.text).slice(0, 48)}`, () => {
      assert.equal(classifySigningFailure(entry.text), entry.problem);
    });
  }
});

describe('formatSigningFailure', () => {
  it('includes host remediation and does not offer a local signer', () => {
    const text = formatSigningFailure(
      new GitCliError('ExitCode', 'git exited with code 128', '/repo', 'gpg: No secret key', 128),
    );
    assert.ok(text);
    assert.match(text, /workspace host/);
    assert.match(text, /user\.signingkey/);
    assert.match(text, /does not sign on its own/);
    assert.match(signingRemediation('gpg-missing'), /does not emulate signing/);
    assert.match(signingRemediation('pinentry'), /does not emulate pinentry/);
  });

  it('ignores ordinary git failures', () => {
    assert.equal(formatSigningFailure(new Error('index.lock exists')), null);
  });
});

describe('annotatedTagArgs', () => {
  it('signs or skips signing and appends a non-HEAD object', () => {
    assert.deepEqual(annotatedTagArgs('v1', 'release', 'HEAD', true), [
      'tag',
      '-a',
      'v1',
      '-m',
      'release',
      '-s',
    ]);
    assert.deepEqual(annotatedTagArgs('v1', 'release', 'abc', false), [
      'tag',
      '-a',
      'v1',
      '-m',
      'release',
      '--no-sign',
      'abc',
    ]);
  });
});
