import { strict as assert } from 'node:assert';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import { fsPathsFromCommandArgs, repoRootContaining, toRepoRelativePosix } from './workspacePaths';

describe('toRepoRelativePosix', () => {
  it('returns a forward-slash path inside the repository', () => {
    const root = path.resolve('/work/repo');
    assert.equal(toRepoRelativePosix(root, path.join(root, 'src', 'a.ts')), 'src/a.ts');
  });

  it('rejects the repository root and paths outside it', () => {
    const root = path.resolve('/work/repo');
    assert.equal(toRepoRelativePosix(root, root), null);
    assert.equal(toRepoRelativePosix(root, path.resolve('/work/other/file')), null);
  });
});

describe('repoRootContaining', () => {
  it('picks the longest repository that contains the file', () => {
    const outer = path.resolve('/work/repo');
    const inner = path.resolve('/work/repo/vendor/lib');
    const file = path.join(inner, 'file.txt');
    assert.equal(repoRootContaining([outer, inner], file), inner);
  });

  it('uses the first root when no file is targeted', () => {
    assert.equal(repoRootContaining(['/work/repo', '/other'], undefined), '/work/repo');
    assert.equal(repoRootContaining([], undefined), null);
  });

  it('returns null when the file is outside every repository', () => {
    assert.equal(repoRootContaining([path.resolve('/work/repo')], path.resolve('/tmp/note.txt')), null);
  });
});

describe('fsPathsFromCommandArgs', () => {
  it('reads a uri argument and a selection list once each', () => {
    assert.deepEqual(
      fsPathsFromCommandArgs({ fsPath: '/work/a.txt' }, [{ fsPath: '/work/a.txt' }, { fsPath: '/work/b.txt' }]),
      ['/work/a.txt', '/work/b.txt'],
    );
  });

  it('ignores values that are not file uris', () => {
    assert.deepEqual(fsPathsFromCommandArgs('branch'), []);
  });
});
