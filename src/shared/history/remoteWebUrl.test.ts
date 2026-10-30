import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { remoteWebUrl } from './remoteWebUrl';

describe('remoteWebUrl', () => {
  const cases: [string, string | undefined][] = [
    ['https://github.com/octo/app.git', 'https://github.com/octo/app'],
    ['https://github.com/octo/app', 'https://github.com/octo/app'],
    ['https://github.com/octo/app/', 'https://github.com/octo/app'],
    ['http://git.example.com:8080/team/app.git', 'http://git.example.com:8080/team/app'],
    ['git@github.com:octo/app.git', 'https://github.com/octo/app'],
    ['github.com:octo/app.git', 'https://github.com/octo/app'],
    ['ssh://git@github.com/octo/app.git', 'https://github.com/octo/app'],
    ['ssh://git@git.example.com:2222/team/sub/app.git', 'https://git.example.com/team/sub/app'],
    ['git://git.example.com/team/app.git', 'https://git.example.com/team/app'],
    ['git+ssh://git@bitbucket.org/team/app.git', 'https://bitbucket.org/team/app'],
    ['git@gitlab.com:group/sub/app.git', 'https://gitlab.com/group/sub/app'],
    ['https://user:secret@github.com/octo/app.git', 'https://github.com/octo/app'],
    ['https://GitHub.com/Octo/App.git', 'https://github.com/Octo/App'],
    ['https://dev.azure.com/org/project/_git/app', 'https://dev.azure.com/org/project/_git/app'],
    ['git@ssh.dev.azure.com:v3/org/project/app', 'https://ssh.dev.azure.com/v3/org/project/app'],
    ['https://github.com/octo/my%20app.git', 'https://github.com/octo/my%20app'],
  ];
  for (const [remote, expected] of cases) {
    it(`gives ${expected ?? 'nothing'} for ${remote}`, () => assert.equal(remoteWebUrl(remote), expected));
  }

  it('gives nothing for a remote that has no page', () => {
    for (const remote of ['', '   ', '/srv/git/app.git', '../app.git', 'file:///srv/git/app.git', 'C:\\work\\app.git', 'C:/work/app.git', 'https://github.com', 'https://github.com/', 'ftp://host/app.git', 'not an address', 'git@host:']) {
      assert.equal(remoteWebUrl(remote), undefined, remote);
    }
  });

  it('never keeps a login, and cannot be made to leave the host by a path that climbs', () => {
    assert.doesNotMatch(remoteWebUrl('https://user:secret@host.test/a/b.git') ?? '', /secret|user/);
    assert.equal(remoteWebUrl('https://host.test/a/../b.git'), 'https://host.test/b', 'the address itself is resolved, and stays on the host');
    assert.equal(remoteWebUrl('host.test:../../x'), undefined);
  });
});
