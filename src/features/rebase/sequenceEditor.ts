import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Builds the GIT_SEQUENCE_EDITOR value that replaces the todo file of an interactive rebase with `todoContent`. Each call gets a
 * folder of its own, so two rebases started in the same millisecond, in two repositories or two windows, cannot overwrite each
 * other's todo. `cleanup` removes it once git has read it.
 */
export function writeTempRebaseTodo(todoContent: string): { todoPath: string; sequenceEditor: string; cleanup: () => void } {
  const root = path.join(os.tmpdir(), 'git-checkout', 'rebase-todo');
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'todo-'));
  const todoPath = path.join(dir, 'todo.txt');
  fs.writeFileSync(todoPath, todoContent, 'utf8');
  const cleanup = (): void => fs.rmSync(dir, { recursive: true, force: true });

  if (process.platform === 'win32') {
    const scriptPath = path.join(dir, 'editor.cmd');
    fs.writeFileSync(scriptPath, `@copy /Y "${todoPath}" %1\r\n`, 'utf8');
    return { todoPath, sequenceEditor: scriptPath, cleanup };
  }

  return { todoPath, sequenceEditor: `cp "${todoPath}"`, cleanup };
}
