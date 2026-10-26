import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { parseGitlinkPaths, parseSubmoduleStatus } from './submoduleParser';

const SHA = '0123456789abcdef0123456789abcdef01234567';
const OTHER = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const CONFLICT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describe('parseSubmoduleStatus', () => {
  it('parses nested status rows including uninitialized and conflict', () => {
    const stdout = [
      ` ${SHA} libs/mid (heads/main)`,
      `+${OTHER} libs/mid/vendor/lib (v1.2.0-1-gabcdef0)`,
      `-${SHA} missing/lib`,
      `U${CONFLICT} conflicted (heads/main)`,
      'not a status line',
      '',
    ].join('\n');

    const entries = parseSubmoduleStatus(stdout, '/repos/super');
    assert.deepEqual(
      entries.map((entry) => [entry.path, entry.status, entry.describe, entry.absolutePath]),
      [
        ['libs/mid', 'ok', 'heads/main', '/repos/super/libs/mid'],
        ['libs/mid/vendor/lib', 'modified', 'v1.2.0-1-gabcdef0', '/repos/super/libs/mid/vendor/lib'],
        ['missing/lib', 'uninitialized', null, '/repos/super/missing/lib'],
        ['conflicted', 'conflict', 'heads/main', '/repos/super/conflicted'],
      ],
    );
    assert.equal(entries[0].sha, SHA);
  });

  it('keeps spaces in the submodule path', () => {
    const entries = parseSubmoduleStatus(` ${SHA} My Libs/mid (heads/main)\n`, '/repos/super');
    assert.equal(entries[0]?.path, 'My Libs/mid');
    assert.equal(entries[0]?.describe, 'heads/main');
  });
});

describe('parseGitlinkPaths', () => {
  it('collects mode 160000 paths from NUL-separated stage output', () => {
    const stdout = [
      `100644 ${SHA} 0\tREADME.md`,
      `160000 ${OTHER} 0\tlibs/mid`,
      `160000 ${SHA} 0\tlibs/mid/vendor/lib`,
    ].join('\0');
    assert.deepEqual([...parseGitlinkPaths(stdout)], ['libs/mid', 'libs/mid/vendor/lib']);
  });
});
