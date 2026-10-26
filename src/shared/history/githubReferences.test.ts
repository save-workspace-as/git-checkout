import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  pullRequestUrl,
  canonicalGitHubCommitUrl,
  canonicalGitHubIssueUrl,
  parseGitHubRemoteUrl,
  pickGitHubRepository,
  segmentGitHubReferences,
  type GitHubRepository,
} from './githubReferences';

const repo: GitHubRepository = { host: 'github.com', owner: 'acme', repo: 'widgets' };

describe('parseGitHubRemoteUrl', () => {
  it('reads https, ssh, and scp GitHub remotes', () => {
    assert.deepEqual(parseGitHubRemoteUrl('https://github.com/acme/widgets.git'), repo);
    assert.deepEqual(parseGitHubRemoteUrl('ssh://git@github.com/acme/widgets.git'), repo);
    assert.deepEqual(parseGitHubRemoteUrl('git@github.com:acme/widgets.git'), repo);
    assert.deepEqual(parseGitHubRemoteUrl('https://www.github.com/acme/widgets'), repo);
  });

  it('reads GitHub Enterprise hosts and ignores other forges', () => {
    assert.deepEqual(parseGitHubRemoteUrl('https://github.example.com/acme/widgets.git'), {
      host: 'github.example.com',
      owner: 'acme',
      repo: 'widgets',
    });
    assert.equal(parseGitHubRemoteUrl('https://gitlab.com/acme/widgets.git'), null);
    assert.equal(parseGitHubRemoteUrl('not a url'), null);
  });
});

describe('pickGitHubRepository', () => {
  it('prefers origin over an earlier GitHub remote', () => {
    const picked = pickGitHubRepository([
      { name: 'upstream', urls: ['git@github.com:other/widgets.git'] },
      { name: 'origin', urls: ['https://gitlab.com/acme/contrib.git', 'git@github.com:acme/widgets.git'] },
    ]);
    assert.deepEqual(picked, repo);
  });
});

describe('segmentGitHubReferences', () => {
  it('links issue and pull request references in titles and messages', () => {
    const text = 'Fix #12, GH-3, acme/other#8, and https://github.com/acme/widgets/pull/9.';
    assert.deepEqual(segmentGitHubReferences(text, repo), [
      { kind: 'text', text: 'Fix ' },
      { kind: 'link', text: '#12', url: 'https://github.com/acme/widgets/issues/12' },
      { kind: 'text', text: ', ' },
      { kind: 'link', text: 'GH-3', url: 'https://github.com/acme/widgets/issues/3' },
      { kind: 'text', text: ', ' },
      { kind: 'link', text: 'acme/other#8', url: 'https://github.com/acme/other/issues/8' },
      { kind: 'text', text: ', and ' },
      { kind: 'link', text: 'https://github.com/acme/widgets/pull/9', url: 'https://github.com/acme/widgets/pull/9' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('leaves same-repo numbers unlinked until the remote is known', () => {
    assert.deepEqual(segmentGitHubReferences('see #4 and other/lib#5', null), [
      { kind: 'text', text: 'see #4 and ' },
      { kind: 'link', text: 'other/lib#5', url: 'https://github.com/other/lib/issues/5' },
    ]);
  });

  it('does not link hashes inside other words', () => {
    assert.deepEqual(segmentGitHubReferences('foo#12 and #0', repo), [
      { kind: 'text', text: 'foo#12 and #0' },
    ]);
  });
});

describe('canonicalGitHubIssueUrl', () => {
  it('accepts issue and pull URLs on the repository host', () => {
    assert.equal(
      canonicalGitHubIssueUrl('http://github.com/acme/widgets/issues/4', repo),
      'https://github.com/acme/widgets/issues/4',
    );
    assert.equal(
      canonicalGitHubIssueUrl('https://github.example.com/acme/widgets/pull/2', {
        host: 'github.example.com',
        owner: 'acme',
        repo: 'widgets',
      }),
      'https://github.example.com/acme/widgets/pull/2',
    );
  });

  it('rejects other hosts, credentials, and non-issue paths', () => {
    assert.equal(canonicalGitHubIssueUrl('https://evil.example/acme/widgets/issues/1', repo), null);
    assert.equal(canonicalGitHubIssueUrl('https://user:token@github.com/acme/widgets/issues/1', repo), null);
    assert.equal(canonicalGitHubIssueUrl('https://github.com/acme/widgets/commit/abcdef', repo), null);
    assert.equal(canonicalGitHubIssueUrl('javascript:alert(1)', repo), null);
  });
});

describe('canonicalGitHubCommitUrl', () => {
  const sha = 'f842f83fd99898bf85f5055d7fa9dc13f2ccc21b';

  it('accepts a commit URL on the repository host', () => {
    assert.equal(
      canonicalGitHubCommitUrl(`http://github.com/acme/widgets/commit/${sha.toUpperCase()}`, repo),
      `https://github.com/acme/widgets/commit/${sha}`,
    );
    assert.equal(
      canonicalGitHubCommitUrl(`https://github.example.com/acme/widgets/commit/${sha}`, {
        host: 'github.example.com', owner: 'acme', repo: 'widgets',
      }),
      `https://github.example.com/acme/widgets/commit/${sha}`,
    );
  });

  it('rejects other hosts, credentials, and a hash that is too short', () => {
    assert.equal(canonicalGitHubCommitUrl(`https://evil.example/acme/widgets/commit/${sha}`, repo), null);
    assert.equal(canonicalGitHubCommitUrl(`https://user:token@github.com/acme/widgets/commit/${sha}`, repo), null);
    assert.equal(canonicalGitHubCommitUrl('https://github.com/acme/widgets/commit/abcdef', repo), null);
    assert.equal(canonicalGitHubCommitUrl('https://github.com/acme/widgets/issues/4', repo), null);
  });
});

describe('pullRequestUrl', () => {
  it('points at the new pull request page of the branch, keeping its slashes', () => {
    assert.equal(
      pullRequestUrl({ host: 'github.com', owner: 'acme', repo: 'app' }, 'feature/new thing'),
      'https://github.com/acme/app/pull/new/feature/new%20thing',
    );
  });
});
