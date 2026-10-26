import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { sidebarRepositoryRoots, type RepositoryKind } from './sidebarRepositories';

const kinds = (table: Record<string, RepositoryKind>) => (root: string) => table[root] ?? 'repository';
const lower = (root: string) => root.toLowerCase();

describe('sidebarRepositoryRoots', () => {
  it('lists workspace folders in folder order, whatever order vscode.git reports them', () => {
    assert.deepEqual(
      sidebarRepositoryRoots(['/w/hycross', '/w/Maccy'], ['/w/Maccy', '/w/hycross']),
      ['/w/Maccy', '/w/hycross'],
    );
  });

  it('lists the same folder once even when it is reported with different letter case', () => {
    assert.deepEqual(
      sidebarRepositoryRoots(['/w/Maccy', '/w/maccy', '/w/hycross'], ['/w/Maccy', '/w/hycross'], kinds({}), lower),
      ['/w/Maccy', '/w/hycross'],
    );
  });

  it('keeps the spelling the workspace folder uses when the same folder is reported twice', () => {
    assert.deepEqual(
      sidebarRepositoryRoots(['/w/maccy', '/w/Maccy'], ['/w/Maccy'], kinds({}), lower),
      ['/w/Maccy'],
    );
  });

  it('skips linked worktrees and submodules that vscode.git detected on its own', () => {
    assert.deepEqual(
      sidebarRepositoryRoots(
        ['/w/Maccy', '/w/hycross', '/w/Maccy-worktrees/appstore', '/w/hycross/ma-baby'],
        ['/w/Maccy', '/w/hycross'],
        kinds({ '/w/Maccy-worktrees/appstore': 'worktree', '/w/hycross/ma-baby': 'submodule' }),
        lower,
      ),
      ['/w/Maccy', '/w/hycross'],
    );
  });

  it('keeps a worktree or submodule that is itself a workspace folder', () => {
    assert.deepEqual(
      sidebarRepositoryRoots(
        ['/w/Maccy', '/w/Maccy-worktrees/appstore'],
        ['/w/Maccy', '/w/Maccy-worktrees/appstore'],
        kinds({ '/w/Maccy-worktrees/appstore': 'worktree' }),
        lower,
      ),
      ['/w/Maccy', '/w/Maccy-worktrees/appstore'],
    );
  });

  it('keeps a nested standalone repository after the workspace folders', () => {
    assert.deepEqual(
      sidebarRepositoryRoots(['/w/tools/other', '/w/Maccy'], ['/w/Maccy'], kinds({}), lower),
      ['/w/Maccy', '/w/tools/other'],
    );
  });

  it('returns nothing when no repository is open', () => {
    assert.deepEqual(sidebarRepositoryRoots([], ['/w/Maccy']), []);
  });
});
