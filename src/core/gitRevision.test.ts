import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { revisionArg } from './gitRevision';

describe('revisionArg', () => {
  it('trims what names a commit and keeps it as it is', () => {
    for (const [given, expected] of [
      ['  main ', 'main'],
      ['HEAD~3', 'HEAD~3'],
      ['origin/feature/x-y', 'origin/feature/x-y'],
      ['v1.0.0^{commit}', 'v1.0.0^{commit}'],
      ['a'.repeat(40), 'a'.repeat(40)],
      ['', ''],
    ]) {
      assert.equal(revisionArg(given), expected);
    }
  });

  it('refuses anything Git would read as an option', () => {
    for (const given of ['--help', '-n1', ' --output=/tmp/x', '--version', '-']) {
      assert.throws(() => revisionArg(given), /Not a valid revision/, given);
    }
  });
});
