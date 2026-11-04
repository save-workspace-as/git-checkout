import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildReviewPrompt, MAX_REVIEW_DIFF_CHARS } from './reviewPrompt';

describe('buildReviewPrompt', () => {
  it('puts the staged changes after the instructions', () => {
    const prompt = buildReviewPrompt('diff --git a/a b/a');
    assert.match(prompt, /^Review the staged changes below/);
    assert.ok(prompt.endsWith('Staged changes:\ndiff --git a/a b/a'));
    assert.match(prompt, /exactly "No issues found\."/);
  });

  it('cuts a diff that is too long and says so', () => {
    const prompt = buildReviewPrompt('x'.repeat(MAX_REVIEW_DIFF_CHARS + 5));
    assert.ok(prompt.endsWith('[diff truncated]'));
    assert.ok(!prompt.includes('x'.repeat(MAX_REVIEW_DIFF_CHARS + 1)));
  });
});
