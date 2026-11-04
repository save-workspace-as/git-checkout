import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildExplainPrompt, MAX_EXPLAIN_DIFF_CHARS } from './commitExplainPrompt';

describe('buildExplainPrompt', () => {
  it('carries the commit message and the changes after the instructions', () => {
    const prompt = buildExplainPrompt({ message: 'fix: x\n\nBecause y.\n', diff: 'diff --git a/a b/a' });
    assert.match(prompt, /^Explain the Git commit below/);
    assert.ok(prompt.includes('Commit message:\nfix: x\n\nBecause y.\n\nChanges:\ndiff --git a/a b/a'));
  });

  it('cuts a diff that is too long and says so', () => {
    const prompt = buildExplainPrompt({ message: 'm', diff: 'x'.repeat(MAX_EXPLAIN_DIFF_CHARS + 5) });
    assert.ok(prompt.endsWith('[diff truncated]'));
    assert.ok(!prompt.includes('x'.repeat(MAX_EXPLAIN_DIFF_CHARS + 1)));
  });
});
