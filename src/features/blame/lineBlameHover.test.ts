import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import type { CommitInfo } from './lineBlameFormat';
import { blameHoverMarkdown, escapeMarkdown, roundedAvatar, type BlameTarget } from './lineBlameHover';
import { encodePng } from './roundPng';

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0);
const repo = { host: 'github.com', owner: 'octo', repo: 'app' };
const target: BlameTarget = { repoRoot: '/work/app', sha: 'abcdef1234567890', path: 'src/a.ts', line: 7 };
const commit = (message: string, over: Partial<CommitInfo> = {}): CommitInfo => ({
  sha: 'abcdef1234567890',
  author: 'Ada Lovelace',
  authorMail: 'ada@example.com',
  authorTime: NOW / 1000 - 3 * 24 * 3600,
  message,
  ...over,
});
const hover = (message: string, over: Partial<CommitInfo> = {}, github: typeof repo | null = repo, avatar?: string): string =>
  blameHoverMarkdown(commit(message, over), target, github, NOW, 'en', avatar);

describe('blameHoverMarkdown', () => {
  it('shows who and when, the message with its references linked, and a row for each reference', () => {
    const text = hover('fix: handle empty input (#12)\n\nCloses #34 and octo/other#5.');
    assert.match(text, /\*\*Ada Lovelace\*\*/);
    assert.match(text, /3 days ago/);
    assert.match(text, /\[\\?#12\]\(https:\/\/github\.com\/octo\/app\/issues\/12\)/);
    assert.match(text, /\[\\?#34\]\(https:\/\/github\.com\/octo\/app\/issues\/34\)/);
    assert.match(text, /\[octo\/other\\?#5\]\(https:\/\/github\.com\/octo\/other\/issues\/5\)/);
    assert.equal(text.match(/\$\(link\) \[GitHub /g)?.length, 3, 'one row for each reference');
    assert.match(text, /\[GitHub \\?#12\]/);
  });

  it('offers the actions for the commit, and the GitHub page only for a repository on GitHub', () => {
    const text = hover('subject');
    for (const command of ['openCommit', 'copyHash', 'openChanges', 'openInBlame', 'stepBack', 'lineHistory']) {
      assert.match(text, new RegExp(`command:gitCheckout\\.blame\\.${command}\\?`));
    }
    assert.match(text, /\(https:\/\/github\.com\/octo\/app\/commit\/abcdef1234567890 "Open on GitHub"\)/);
    assert.doesNotMatch(hover('subject', {}, null), /github\.com/);
  });

  it('passes the target to the commands as one encoded argument', () => {
    const argument = /command:gitCheckout\.blame\.copyHash\?([^ )]+)/.exec(hover('subject'))?.[1] ?? '';
    assert.deepEqual(JSON.parse(decodeURIComponent(argument)), [{ repoRoot: '/work/app', sha: 'abcdef1234567890', path: 'src/a.ts', line: 7 }]);
  });

  it('hands the commands the path the file had in the commit', () => {
    const withPrevious: BlameTarget = { ...target, commitPath: 'src/old.ts' };
    const text = blameHoverMarkdown(commit('s'), withPrevious, repo, NOW, 'en');
    const argument = /command:gitCheckout\.blame\.openChanges\?([^ )]+)/.exec(text)?.[1] ?? '';
    assert.deepEqual(JSON.parse(decodeURIComponent(argument))[0], { ...withPrevious, sha: 'abcdef1234567890' });
  });

  it('shows the picture only from roundedAvatar or from GitHub, and not an address that could carry markup', () => {
    const png = encodePng({ width: 2, height: 2, data: Buffer.alloc(16, 255) });
    const rounded = roundedAvatar(png, 'image/png') ?? '';
    assert.match(hover('s', {}, repo, rounded), /!\[\]\(data:image\/png;base64,[A-Za-z0-9+/=]+\|width=32,height=32\)/);
    assert.match(hover('s', {}, repo, 'https://avatars.githubusercontent.com/u/1?s=64'), /!\[\]\(https:\/\/avatars\.githubusercontent\.com\/u\/1\?s=64\|width=32/);
    for (const bad of ['javascript:alert(1)', 'https://evil.test/a.png', 'data:image/svg+xml;base64,AAAA', 'data:image/png;base64,AAAA)[b](command:evil)', 'https://avatars.githubusercontent.com/u/1)[x](command:evil)']) {
      assert.doesNotMatch(hover('s', {}, repo, bad), /!\[\]/, bad);
    }
  });

  it('cannot be made to run a command or add a link by what a commit says', () => {
    const text = hover('[click](command:workbench.action.reloadWindow) <b>x</b> `y`', { author: '[a](command:evil)' });
    assert.doesNotMatch(text, /\]\(command:workbench/);
    assert.doesNotMatch(text, /\]\(command:evil/);
    assert.doesNotMatch(text, /<b>/);
  });

  it('links a tracker reference, and names a GitHub one as GitHub but a tracker one as itself', () => {
    const jira = { prefix: 'JIRA-', url: 'https://jira.example.com/browse/JIRA-<num>', ignoreCase: false, alphanumeric: false };
    const text = blameHoverMarkdown(commit('JIRA-12 fix (#3)'), target, repo, NOW, 'en', undefined, [jira]);
    assert.match(text, /\[JIRA-12\]\(https:\/\/jira\.example\.com\/browse\/JIRA-12\)/);
    assert.match(text, /\$\(link\) \[JIRA-12\]\(https:\/\/jira/);
    assert.match(text, /\$\(link\) \[GitHub \\?#3\]/);
  });

  it('says a line that is not committed yet is yours', () => {
    assert.equal(hover('', { sha: '0'.repeat(40) }), '**You**, uncommitted changes');
  });
});

describe('roundedAvatar', () => {
  it('gives a PNG address for a PNG, and nothing for what it cannot cut', () => {
    const png = encodePng({ width: 2, height: 2, data: Buffer.alloc(16, 255) });
    assert.match(roundedAvatar(png, 'image/png') ?? '', /^data:image\/png;base64,/);
    assert.equal(roundedAvatar(png, 'image/svg+xml'), undefined, 'an SVG could carry scripts or links');
    assert.equal(roundedAvatar(png, 'image/jpeg'), undefined);
    assert.equal(roundedAvatar(new Uint8Array([1, 2, 3]), 'image/png'), undefined, 'not a PNG');
  });
});

describe('escapeMarkdown', () => {
  it('escapes what Markdown reads', () => {
    assert.equal(escapeMarkdown('a_b *c* [d](e) `f` # g'), 'a\\_b \\*c\\* \\[d\\]\\(e\\) \\`f\\` \\# g');
    assert.equal(escapeMarkdown('- item'), '\\- item');
  });
});
