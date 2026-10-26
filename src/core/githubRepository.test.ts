import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { loadGitHubRepository } from './githubRepository';

describe('loadGitHubRepository', () => {
  it('resolves origin from git remote urls', async () => {
    const repo = await loadGitHubRepository({
      execRead: async (args) => {
        if (args[0] === 'remote' && args.length === 1) {
          return { stdout: 'upstream\norigin\n' };
        }
        if (args[0] === 'remote' && args.at(-1) === 'origin') {
          return { stdout: 'git@github.com:acme/widgets.git\n' };
        }
        return { stdout: 'https://gitlab.com/acme/widgets.git\n' };
      },
    });
    assert.deepEqual(repo, { host: 'github.com', owner: 'acme', repo: 'widgets' });
  });

  it('returns null when the repository has no remotes', async () => {
    const repo = await loadGitHubRepository({
      execRead: async () => ({ stdout: '' }),
    });
    assert.equal(repo, null);
  });
});
