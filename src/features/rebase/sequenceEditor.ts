import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Build GIT_SEQUENCE_EDITOR value that replaces the todo file with `todoContent`. */
export function writeTempRebaseTodo(todoContent: string): { todoPath: string; sequenceEditor: string } {
  const dir = path.join(os.tmpdir(), 'gh-aw', 'agent', 'rebase-todo');
  fs.mkdirSync(dir, { recursive: true });
  const todoPath = path.join(dir, `todo-${Date.now()}.txt`);
  fs.writeFileSync(todoPath, todoContent, 'utf8');

  if (process.platform === 'win32') {
    const scriptPath = path.join(dir, `editor-${Date.now()}.cmd`);
    fs.writeFileSync(scriptPath, `@copy /Y "${todoPath}" %1\r\n`, 'utf8');
    return { todoPath, sequenceEditor: scriptPath };
  }

  return { todoPath, sequenceEditor: `cp "${todoPath}"` };
}
