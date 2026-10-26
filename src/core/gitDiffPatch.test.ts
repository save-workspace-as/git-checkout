import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { parseUnifiedDiff } from './gitDiffParser';
import { buildHunkPatch, buildLinePatch } from './gitDiffPatch';

const SAMPLE = `diff --git a/file.txt b/file.txt
--- a/file.txt
+++ b/file.txt
@@ -1,4 +1,5 @@
 alpha
-beta
+gamma
 delta
+epsilon
`;

describe('gitDiffPatch', () => {
  it('builds a full hunk patch', () => {
    const { files } = parseUnifiedDiff(SAMPLE);
    const patch = buildHunkPatch(files[0], 0);
    assert.match(patch, /^diff --git/);
    assert.match(patch, /@@ -1,4 \+1,5 @@|@@ -1,3 \+1,4 @@/);
    assert.match(patch, /\+gamma/);
  });

  it('builds a single-line patch with context', () => {
    const { files } = parseUnifiedDiff(SAMPLE);
    const patch = buildLinePatch(files[0], 0, 2);
    assert.match(patch, /\+gamma/);
    assert.doesNotMatch(patch, /\+epsilon/);
  });
});
