import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { buildCommitPrompt, MAX_DIFF_CHARS, parseGeneratedMessage } from './commitMessagePrompt';

describe('buildCommitPrompt', () => {
  it('includes the diff and recent subjects', () => {
    const prompt = buildCommitPrompt({ diff: 'diff --git a/x b/x', recentSubjects: ['feat(a): one', 'fix(b): two'] });
    assert.match(prompt, /Staged changes:\ndiff --git a\/x b\/x/);
    assert.match(prompt, /- feat\(a\): one\n- fix\(b\): two/);
    assert.match(prompt, /commit message only/);
  });

  it('cuts a huge diff and says so', () => {
    const prompt = buildCommitPrompt({ diff: 'x'.repeat(MAX_DIFF_CHARS + 500), recentSubjects: [] });
    assert.match(prompt, /\[diff truncated\]$/);
    assert.ok(prompt.length < MAX_DIFF_CHARS + 1500);
    assert.doesNotMatch(prompt, /Recent commit subjects/);
  });
});

describe('parseGeneratedMessage', () => {
  it('splits subject and body', () => {
    assert.deepEqual(parseGeneratedMessage('fix(git): stop the hang\n\nWrites queued behind themselves.\n'), {
      subject: 'fix(git): stop the hang',
      description: 'Writes queued behind themselves.',
    });
  });

  it('strips fences, quotes and a lead-in', () => {
    assert.deepEqual(parseGeneratedMessage('```\n"Add a thing"\n\nBody\n```'), { subject: 'Add a thing', description: 'Body' });
    assert.equal(parseGeneratedMessage('Commit message: Add a thing').subject, 'Add a thing');
    assert.deepEqual(parseGeneratedMessage('  '), { subject: '', description: '' });
  });
});
