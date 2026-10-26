import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { parseSubmoduleLogOutput, parseSubmoduleShasFromDiffText } from './submoduleDiff';

describe('submoduleDiff', () => {
  it('parses subproject commit lines from diff text', () => {
    const diff = `diff --git a/mod b/mod
--- a/mod
+++ b/mod
@@ -1 +1 @@
-Subproject commit aaa1111
+Subproject commit bbb2222
`;
    const pair = parseSubmoduleShasFromDiffText(diff);
    assert.ok(pair);
    assert.equal(pair.oldSha, 'aaa1111');
    assert.equal(pair.newSha, 'bbb2222');
  });

  it('parses git log tab output', () => {
    const commits = parseSubmoduleLogOutput(
      'abc1234\tfirst\n' + 'def5678\tsecond\n',
    );
    assert.equal(commits.length, 2);
    assert.equal(commits[0].sha, 'abc1234');
    assert.equal(commits[0].subject, 'first');
  });
});
