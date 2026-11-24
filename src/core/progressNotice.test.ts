import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { gitSubcommand, noticeIfSlow } from './progressNotice';

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') && !path.endsWith('.test.ts') ? [path] : [];
  });
}

describe('gitSubcommand', () => {
  it('names the command after the options that come before it', () => {
    assert.equal(gitSubcommand(['worktree', 'remove', '/x']), 'worktree');
    assert.equal(gitSubcommand(['-C', '/repo', 'submodule', 'deinit']), 'submodule');
    assert.equal(gitSubcommand(['-c', 'user.name=x', '--no-pager', 'commit', '-m', 'm']), 'commit');
    assert.equal(gitSubcommand([]), 'command');
  });
});

describe('noticeIfSlow', () => {
  it('returns the result, and rethrows the failure, of the command outside VS Code', async () => {
    assert.equal(await noticeIfSlow(['gc'], async () => 7, 0), 7);
    await assert.rejects(() => noticeIfSlow(['gc'], async () => { throw new Error('failed'); }, 0), /failed/);
  });
});

describe('progress notifications', () => {
  it('all go through withProgress, so a slow Git command does not add a second one to an operation that shows its own', () => {
    const direct = sourceFiles(join(__dirname, '..'))
      .filter((file) => !file.endsWith('progressNotice.ts'))
      .filter((file) => readFileSync(file, 'utf8').includes('vscode.window.withProgress('));
    assert.deepEqual(direct, []);
  });
});
