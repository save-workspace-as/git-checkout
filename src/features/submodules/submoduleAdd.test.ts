import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { submoduleAddArgs, validateSubmoduleAdd } from './submoduleAdd';

describe('submodule addition', () => {
  const request = { url: 'https://example.test/library.git', path: 'libs/library', branch: '' };
  it('separates positional arguments and supports an optional tracking branch', () => {
    assert.deepEqual(submoduleAddArgs(request), ['submodule', 'add', '--', request.url, request.path]);
    assert.deepEqual(submoduleAddArgs({ ...request, branch: ' main ' }),
      ['submodule', 'add', '-b', 'main', '--', request.url, request.path]);
  });

  for (const destination of ['', '.', '..', '../outside', 'libs/../../outside', '/absolute', '.git/lib', 'libs/.GIT/lib', '-bad', 'bad\0path']) {
    it(`rejects invalid destination ${JSON.stringify(destination)}`, () => {
      assert.ok(validateSubmoduleAdd({ ...request, path: destination }).path);
      assert.throws(() => submoduleAddArgs({ ...request, path: destination }));
    });
  }

  it('rejects options and control characters but allows local paths containing spaces', () => {
    assert.ok(validateSubmoduleAdd({ ...request, url: '--upload-pack=bad' }).url);
    assert.ok(validateSubmoduleAdd({ ...request, url: 'bad\nurl' }).url);
    assert.ok(validateSubmoduleAdd({ ...request, branch: '--bad' }).branch);
    assert.deepEqual(validateSubmoduleAdd({ ...request, url: '/local library', path: 'libs/local library' }), {});
  });
});
