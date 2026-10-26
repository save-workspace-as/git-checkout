import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  describePointerVersusContent,
  formatLfsPointerLabel,
  isLfsPointerText,
  parseLfsPointer,
} from './lfsPointer';

describe('lfsPointer', () => {
  const sample = `version https://git-lfs.github.com/spec/v1
oid sha256:4d7a214614ab2935c943f9a15698f1323bddb093b995844a6503eaf3bbb788f2
size 12345
`;

  it('detects and parses a pointer file', () => {
    assert.equal(isLfsPointerText(sample), true);
    const parsed = parseLfsPointer(sample);
    assert.ok(parsed);
    assert.equal(parsed.oid, '4d7a214614ab2935c943f9a15698f1323bddb093b995844a6503eaf3bbb788f2');
    assert.equal(parsed.size, 12345);
  });

  it('returns null for non-pointer text', () => {
    assert.equal(isLfsPointerText('hello'), false);
    assert.equal(parseLfsPointer('not lfs'), null);
  });

  it('formats a pointer the same way the working-copy diff does', () => {
    const parsed = parseLfsPointer(sample);
    assert.ok(parsed);
    assert.equal(
      formatLfsPointerLabel(parsed),
      'oid 4d7a214614ab… · 12345 bytes',
    );
    assert.equal(formatLfsPointerLabel(undefined), '(missing)');
  });

  it('describes pointer storage against smudged working-tree content', () => {
    const stored = parseLfsPointer(sample);
    assert.equal(
      describePointerVersusContent(stored, true),
      'Working tree has file content. Git stores a pointer (oid 4d7a214614ab… · 12345 bytes).',
    );
    assert.equal(
      describePointerVersusContent(stored, false),
      'Working tree still holds the pointer (oid 4d7a214614ab… · 12345 bytes).',
    );
    assert.equal(
      describePointerVersusContent(null, true),
      'Git does not store a Git LFS pointer for this file.',
    );
  });
});
