import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { avatarFromCommitResponse, GitHubAvatars, noReplyAvatarUrl, type GitHubAvatarHost } from './githubAvatars';

const repo = { host: 'github.com', owner: 'acme', repo: 'app' };

function host(responses: Record<string, { status: number; body: unknown }>, token?: string) {
  const asked: { url: string; token: string | undefined }[] = [];
  let now = 1000;
  const value: GitHubAvatarHost = {
    async get(url, given) {
      asked.push({ url, token: given });
      return responses[url.split('/').at(-1) ?? ''] ?? { status: 404, body: {} };
    },
    token: async () => token,
    now: () => now,
  };
  return { value, asked, advance: (ms: number) => { now += ms; } };
}

describe('GitHub avatars', () => {
  it('reads the account from a no-reply address without asking GitHub', () => {
    assert.equal(noReplyAvatarUrl('123+ada@users.noreply.github.com'), 'https://avatars.githubusercontent.com/u/123?s=64');
    assert.equal(noReplyAvatarUrl('ada@users.noreply.github.com'), 'https://avatars.githubusercontent.com/ada?s=64');
    assert.equal(noReplyAvatarUrl('ada@example.com'), undefined);
  });

  it('takes the picture from the commit API and only from GitHub avatar addresses', () => {
    assert.equal(avatarFromCommitResponse({ author: { avatar_url: 'https://avatars.githubusercontent.com/u/9?v=4' } }), 'https://avatars.githubusercontent.com/u/9?v=4');
    assert.equal(avatarFromCommitResponse({ author: null }), null);
    assert.equal(avatarFromCommitResponse({ author: { avatar_url: 'https://evil.example/x.png' } }), null);
  });

  it('looks each address up once, from one commit, with the sign-in when there is one', async () => {
    const h = host({ aaa: { status: 200, body: { author: { avatar_url: 'https://avatars.githubusercontent.com/u/1' } } } }, 'secret');
    const avatars = new GitHubAvatars(h.value);
    const found = await avatars.lookUp(repo, [
      { sha: 'aaa', authorEmail: 'Ada@Example.com' }, { sha: 'bbb', authorEmail: 'ada@example.com' },
      { sha: 'ccc', authorEmail: 'nobody@example.com' }, { sha: 'ddd', authorEmail: '7+bot@users.noreply.github.com' },
    ]);
    assert.deepEqual(found, { 'ada@example.com': 'https://avatars.githubusercontent.com/u/1' });
    assert.deepEqual(h.asked.map((entry) => entry.url), [
      'https://api.github.com/repos/acme/app/commits/aaa', 'https://api.github.com/repos/acme/app/commits/ccc',
    ]);
    assert.ok(h.asked.every((entry) => entry.token === 'secret'));
    assert.equal(avatars.known('nobody@example.com'), null, 'an author without an account is not asked about again');
    await avatars.lookUp(repo, [{ sha: 'eee', authorEmail: 'ada@example.com' }]);
    assert.equal(h.asked.length, 2);
  });

  it('stops asking for a while once GitHub reports the rate limit', async () => {
    const h = host({ aaa: { status: 403, body: {} } });
    const avatars = new GitHubAvatars(h.value);
    await avatars.lookUp(repo, [{ sha: 'aaa', authorEmail: 'a@x.com' }, { sha: 'bbb', authorEmail: 'b@x.com' }]);
    assert.equal(h.asked.length, 1);
    await avatars.lookUp(repo, [{ sha: 'bbb', authorEmail: 'b@x.com' }]);
    assert.equal(h.asked.length, 1, 'paused');
    h.advance(16 * 60_000);
    await avatars.lookUp(repo, [{ sha: 'bbb', authorEmail: 'b@x.com' }]);
    assert.equal(h.asked.length, 2, 'asks again later');
  });
});
