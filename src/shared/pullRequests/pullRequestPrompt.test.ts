import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildPullRequestPrompt, canTravelInLink, linkableTitle, MAX_PULL_REQUEST_DIFF_CHARS, parsePullRequestText } from './pullRequestPrompt';

describe('buildPullRequestPrompt', () => {
  const input = {
    branch: 'feat/x', base: 'origin/main',
    commits: [{ subject: 'feat: add x', body: 'Because y.\nAnd z.' }, { subject: 'fix: typo', body: '' }],
    diff: 'diff --git a/a b/a',
  };

  it('names the branch and its base, lists the commits with their bodies, and carries the changes', () => {
    const prompt = buildPullRequestPrompt(input);
    assert.match(prompt, /for the branch "feat\/x", to merge into "origin\/main"/);
    assert.match(prompt, /- feat: add x\n {2}Because y\.\n {2}And z\.\n- fix: typo\n/);
    assert.ok(prompt.endsWith('Changes:\ndiff --git a/a b/a'));
  });

  it('cuts a diff that is too long and says so', () => {
    const prompt = buildPullRequestPrompt({ ...input, diff: 'x'.repeat(MAX_PULL_REQUEST_DIFF_CHARS + 10) });
    assert.ok(prompt.endsWith('[diff truncated]'));
    assert.ok(!prompt.includes('x'.repeat(MAX_PULL_REQUEST_DIFF_CHARS + 1)));
  });
});

describe('parsePullRequestText', () => {
  it('takes the first line as the title and the rest as the description', () => {
    assert.deepEqual(parsePullRequestText('Add x\n\nSummary.\n\n- one\n- two\n'), { title: 'Add x', body: 'Summary.\n\n- one\n- two' });
  });

  it('drops a fence, quotes, a heading mark and a "Title:" lead-in', () => {
    assert.deepEqual(parsePullRequestText('```markdown\n# Title: "Add x"\n\nBody\n```'), { title: 'Add x', body: 'Body' });
    assert.equal(parsePullRequestText('**Add x**\n\nBody').title, 'Add x');
  });

  it('drops a "Description:" label before the body', () => {
    assert.equal(parsePullRequestText('Add x\n\n## Description\nBody').body, 'Body');
    assert.equal(parsePullRequestText('Add x\n\nDescription:\nBody').body, 'Body');
  });

  it('gives an empty title for an empty reply', () => {
    assert.deepEqual(parsePullRequestText('  \n'), { title: '', body: '' });
  });
});

describe('what a link can carry', () => {
  it('refuses the characters VS Code would read as query syntax', () => {
    for (const text of ['a & b', 'fixes #12', 'C++']) assert.equal(canTravelInLink(text), false, text);
    assert.equal(canTravelInLink('Plain text, with: punctuation (and "quotes")\nand lines'), true);
  });

  it('writes out or drops those characters in a title', () => {
    assert.equal(linkableTitle('Add A & B'), 'Add A and B');
    assert.equal(linkableTitle('Fix #12 in C++'), 'Fix 12 in C plus plus');
    assert.equal(linkableTitle('Plain'), 'Plain');
  });
});
