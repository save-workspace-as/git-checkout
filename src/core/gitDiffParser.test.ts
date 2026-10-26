import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { findDiffFileForPath, parseUnifiedDiff } from './gitDiffParser';

describe('parseUnifiedDiff', () => {
  it('parses hunks and line kinds', () => {
    const input = `diff --git a/foo.txt b/foo.txt
index 123..456 100644
--- a/foo.txt
+++ b/foo.txt
@@ -1,3 +1,4 @@
 line1
-old
+new
+added
`;

    const { files, warnings } = parseUnifiedDiff(input);
    assert.equal(warnings.length, 0);
    assert.equal(files.length, 1);
    const file = files[0];
    assert.equal(file.newPath, 'foo.txt');
    assert.equal(file.binary, false);
    assert.equal(file.hunks.length, 1);
    const hunk = file.hunks[0];
    assert.equal(hunk.lines.length, 4);
    assert.equal(hunk.lines[1].kind, 'del');
    assert.equal(hunk.lines[2].kind, 'add');
  });

  it('handles quoted paths from core.quotepath', () => {
    const input = `diff --git "a/path with spaces.txt" "b/path with spaces.txt"
--- a/path with spaces.txt
+++ b/path with spaces.txt
@@ -1 +1 @@
-x
+y
`;
    const { files } = parseUnifiedDiff(input);
    assert.equal(files[0].newPath, 'path with spaces.txt');
    assert.equal(findDiffFileForPath(files, 'path with spaces.txt')?.newPath, 'path with spaces.txt');
  });

  it('marks binary files without crashing', () => {
    const input = `diff --git a/bin.dat b/bin.dat
Binary files a/bin.dat and b/bin.dat differ
`;
    const { files } = parseUnifiedDiff(input);
    assert.equal(files.length, 1);
    assert.equal(files[0].binary, true);
    assert.equal(files[0].hunks.length, 0);
  });

  it('normalizes CRLF in diff text', () => {
    const input = 'diff --git a/a.txt b/a.txt\r\n--- a/a.txt\r\n+++ b/a.txt\r\n@@ -1 +1 @@\r\n-x\r\n+y\r\n';
    const { files } = parseUnifiedDiff(input);
    assert.equal(files[0].hunks[0].lines[0].kind, 'del');
  });

  it('returns empty result for empty input', () => {
    const { files, warnings } = parseUnifiedDiff('   \n');
    assert.equal(files.length, 0);
    assert.equal(warnings.length, 0);
  });
});
