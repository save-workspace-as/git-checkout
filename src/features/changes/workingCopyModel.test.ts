import { strict as assert } from 'node:assert';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import {
  assertRepoRelativePath,
  buildWorkingCopyEntries,
  parseUnmergedPaths,
  withConflicts,
  parseLsFilesFlags,
  parsePorcelainChanges,
  projectWorkingCopyAction,
  toAbsoluteRepoPath,
  workingCopyStatusLabel,
} from './workingCopyModel';
import type { WorkingCopyEntryDto } from '../../shared/changes/workingCopyProtocol';
import { GitChangeStatus, type GitChange } from '../../core/vscodeGitApi';

const REPO = path.join('/repos', 'demo');

function change(
  rel: string,
  status: GitChangeStatus,
  originalRel = rel,
): GitChange {
  return {
    uri: { fsPath: path.join(REPO, ...rel.split('/')) },
    originalUri: { fsPath: path.join(REPO, ...originalRel.split('/')) },
    status,
  } as GitChange;
}

describe('workingCopyStatusLabel', () => {
  it('keeps vscode.git Status numeric values', () => {
    assert.equal(GitChangeStatus.INDEX_MODIFIED, 0);
    assert.equal(GitChangeStatus.UNTRACKED, 7);
    assert.equal(GitChangeStatus.BOTH_MODIFIED, 18);
  });

  it('maps index and conflict statuses', () => {
    assert.equal(workingCopyStatusLabel(GitChangeStatus.INDEX_RENAMED), 'renamed');
    assert.equal(workingCopyStatusLabel(GitChangeStatus.BOTH_ADDED), 'conflict');
    assert.equal(workingCopyStatusLabel(99 as GitChangeStatus), 'unknown');
  });
});

describe('assertRepoRelativePath', () => {
  it('accepts nested relative paths', () => {
    assert.equal(assertRepoRelativePath('src/app.ts'), 'src/app.ts');
    assert.equal(assertRepoRelativePath('src\\app.ts'), 'src/app.ts');
  });

  it('accepts a folder with a trailing slash, as Git lists an untracked nested repository', () => {
    assert.equal(assertRepoRelativePath('vendor/lib/'), 'vendor/lib');
  });

  it('names the rejected path', () => {
    assert.throws(() => assertRepoRelativePath('../secret'), /Invalid working-copy path: "\.\.\/secret"/);
  });

  it('rejects paths that leave the repository', () => {
    assert.throws(() => assertRepoRelativePath('../secret'), /Invalid working-copy path/);
    assert.throws(() => assertRepoRelativePath('/etc/passwd'), /Invalid working-copy path/);
    assert.throws(() => assertRepoRelativePath(''), /Invalid working-copy path/);
  });
});

describe('parseUnmergedPaths', () => {
  it('lists each path that has entries at a merge stage once', () => {
    const output = [
      '100644 aaaaaaa 0\tclean.ts',
      '100644 bbbbbbb 1\tboth.ts', '100644 ccccccc 2\tboth.ts', '100644 ddddddd 3\tboth.ts',
      '100644 eeeeeee 1\tgone.ts', '100644 fffffff 3\tgone.ts',
      '',
    ].join('\0');
    assert.deepEqual([...parseUnmergedPaths(output)], ['both.ts', 'gone.ts']);
    assert.equal(parseUnmergedPaths('').size, 0);
  });

  it('keeps tabs and spaces in a path', () => {
    assert.deepEqual([...parseUnmergedPaths('100644 aaa 2\tdir/a b\tc.ts\0')], ['dir/a b\tc.ts']);
  });
});

describe('withConflicts', () => {
  const entries = [
    { path: 'dirty.ts', group: 'unstaged' as const, status: 'modified' as const },
    { path: 'both.ts', group: 'unstaged' as const, status: 'modified' as const },
    { path: 'new.ts', group: 'untracked' as const, status: 'untracked' as const },
  ];

  it('adds a conflict for an unmerged path that was not listed, replacing its other rows', () => {
    const result = withConflicts(entries, new Set(['both.ts', 'gone.ts']));
    assert.deepEqual(
      result.map((entry) => `${entry.group}:${entry.path}:${entry.status}`),
      ['unstaged:both.ts:conflict', 'unstaged:dirty.ts:modified', 'unstaged:gone.ts:conflict', 'untracked:new.ts:untracked'],
    );
  });

  it('does not list a conflict twice, and changes nothing without unmerged paths', () => {
    const listed = [{ path: 'both.ts', group: 'unstaged' as const, status: 'conflict' as const }];
    assert.equal(withConflicts(listed, new Set(['both.ts'])).length, 1);
    assert.deepEqual(withConflicts(entries, new Set()), entries);
  });
});

describe('buildWorkingCopyEntries', () => {
  it('lists staged, unstaged, and untracked changes', () => {
    const entries = buildWorkingCopyEntries(REPO, {
      indexChanges: [change('staged.ts', GitChangeStatus.INDEX_MODIFIED)],
      workingTreeChanges: [change('dirty.ts', GitChangeStatus.MODIFIED)],
      untrackedChanges: [change('new.ts', GitChangeStatus.UNTRACKED)],
    });
    assert.deepEqual(
      entries.map((entry) => `${entry.group}:${entry.path}:${entry.status}`),
      ['staged:staged.ts:modified', 'unstaged:dirty.ts:modified', 'untracked:new.ts:untracked'],
    );
  });

  it('lists conflicted files, which vscode.git keeps in mergeChanges, with the unstaged changes', () => {
    const entries = buildWorkingCopyEntries(REPO, {
      mergeChanges: [change('both.ts', GitChangeStatus.BOTH_MODIFIED), change('gone.ts', GitChangeStatus.DELETED_BY_THEM)],
      workingTreeChanges: [change('dirty.ts', GitChangeStatus.MODIFIED), change('both.ts', GitChangeStatus.MODIFIED)],
    });
    assert.deepEqual(
      entries.map((entry) => `${entry.group}:${entry.path}:${entry.status}`),
      ['unstaged:both.ts:conflict', 'unstaged:dirty.ts:modified', 'unstaged:gone.ts:conflict'],
    );
  });

  it('treats untracked rows on workingTreeChanges as untracked', () => {
    const entries = buildWorkingCopyEntries(REPO, {
      workingTreeChanges: [change('new.ts', GitChangeStatus.UNTRACKED)],
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.group, 'untracked');
  });

  it('does not duplicate untracked paths present in both lists', () => {
    const entries = buildWorkingCopyEntries(REPO, {
      workingTreeChanges: [change('new.ts', GitChangeStatus.UNTRACKED)],
      untrackedChanges: [change('new.ts', GitChangeStatus.UNTRACKED)],
    });
    assert.equal(entries.length, 1);
  });

  it('records the previous path for a rename', () => {
    const entries = buildWorkingCopyEntries(REPO, {
      indexChanges: [change('b.ts', GitChangeStatus.INDEX_RENAMED, 'a.ts')],
    });
    assert.equal(entries[0]?.originalPath, 'a.ts');
    assert.equal(entries[0]?.path, 'b.ts');
  });

  it('sorts paths within a group', () => {
    const entries = buildWorkingCopyEntries(REPO, {
      indexChanges: [
        change('z.ts', GitChangeStatus.INDEX_ADDED),
        change('a.ts', GitChangeStatus.INDEX_ADDED),
      ],
    });
    assert.deepEqual(
      entries.map((entry) => entry.path),
      ['a.ts', 'z.ts'],
    );
  });
});

describe('parsePorcelainChanges', () => {
  it('reads staged, unstaged, renamed, and untracked records', () => {
    const entries = parsePorcelainChanges(
      ' M a.txt\0RM sub/new.txt\0sub/old.txt\0?? c.txt\0M  kept.txt\0UU both.txt\0',
    );
    assert.deepEqual(
      entries.map((entry) => `${entry.group}:${entry.path}:${entry.status}:${entry.originalPath ?? ''}`),
      [
        'staged:kept.txt:modified:',
        'staged:sub/new.txt:renamed:sub/old.txt',
        'unstaged:a.txt:modified:',
        'unstaged:both.txt:conflict:',
        'unstaged:sub/new.txt:modified:',
        'untracked:c.txt:untracked:',
      ],
    );
  });

  it('returns nothing for an empty status', () => {
    assert.deepEqual(parsePorcelainChanges(''), []);
  });
});

describe('projectWorkingCopyAction', () => {
  const entries: WorkingCopyEntryDto[] = [
    { path: 'keep.ts', group: 'staged', status: 'modified' },
    { path: 'dirty.ts', group: 'unstaged', status: 'modified' },
    { path: 'new.ts', group: 'untracked', status: 'untracked' },
    { path: 'both.ts', group: 'staged', status: 'modified' },
    { path: 'both.ts', group: 'unstaged', status: 'modified' },
  ];

  it('moves a file into the index and keeps its id-stable path', () => {
    const staged = projectWorkingCopyAction(entries, { op: 'stage', path: 'dirty.ts' });
    assert.deepEqual(
      staged.filter((entry) => entry.path === 'dirty.ts').map((entry) => `${entry.group}:${entry.status}`),
      ['staged:modified'],
    );
    const added = projectWorkingCopyAction(entries, { op: 'stage', path: 'new.ts' });
    assert.equal(
      added.find((entry) => entry.path === 'new.ts')?.status,
      'added',
    );
  });

  it('drops the unstaged row when the path is already partly staged', () => {
    const next = projectWorkingCopyAction(entries, { op: 'stage', path: 'both.ts' });
    assert.deepEqual(
      next.filter((entry) => entry.path === 'both.ts').map((entry) => entry.group),
      ['staged'],
    );
  });

  it('unstages an added file back to untracked and leaves a worktree row in place', () => {
    const added: WorkingCopyEntryDto[] = [{ path: 'new.ts', group: 'staged', status: 'added' }];
    assert.equal(projectWorkingCopyAction(added, { op: 'unstage', path: 'new.ts' })[0]?.group, 'untracked');
    const partial = projectWorkingCopyAction(entries, { op: 'unstage', path: 'both.ts' });
    assert.deepEqual(
      partial.filter((entry) => entry.path === 'both.ts').map((entry) => entry.group),
      ['unstaged'],
    );
  });

  it('removes every row for a discarded path', () => {
    const next = projectWorkingCopyAction(entries, { op: 'discard', path: 'both.ts' });
    assert.equal(next.some((entry) => entry.path === 'both.ts'), false);
    assert.equal(next.length, entries.length - 2);
  });
});

describe('parseLsFilesFlags', () => {
  it('returns assume-unchanged and skip-worktree files', () => {
    const output = ['H kept.ts', 'h assumed.ts', 'S skipped.ts', 's both.ts', 'M conflict.ts'].join(
      '\0',
    );
    assert.deepEqual(parseLsFilesFlags(`${output}\0`), [
      { path: 'assumed.ts', assumeUnchanged: true, skipWorktree: false },
      { path: 'skipped.ts', assumeUnchanged: false, skipWorktree: true },
      { path: 'both.ts', assumeUnchanged: true, skipWorktree: true },
    ]);
  });

  it('keeps spaces in paths', () => {
    assert.deepEqual(parseLsFilesFlags('h my file.ts\0'), [
      { path: 'my file.ts', assumeUnchanged: true, skipWorktree: false },
    ]);
  });

  it('returns an empty list for empty output', () => {
    assert.deepEqual(parseLsFilesFlags(''), []);
  });
});

describe('toAbsoluteRepoPath', () => {
  it('joins a repo-relative path onto the root', () => {
    assert.equal(toAbsoluteRepoPath(REPO, 'src/app.ts'), path.join(REPO, 'src', 'app.ts'));
  });
});
