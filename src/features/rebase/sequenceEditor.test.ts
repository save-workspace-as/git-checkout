import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { writeTempRebaseTodo } from './sequenceEditor';

describe('writeTempRebaseTodo', () => {
  it('gives each call a file of its own, even when they come in the same millisecond', () => {
    const todos = Array.from({ length: 20 }, (_, index) => writeTempRebaseTodo(`pick ${index} subject ${index}\n`));
    try {
      assert.equal(new Set(todos.map((todo) => todo.todoPath)).size, todos.length);
      todos.forEach((todo, index) => assert.equal(readFileSync(todo.todoPath, 'utf8'), `pick ${index} subject ${index}\n`));
    } finally {
      todos.forEach((todo) => todo.cleanup());
    }
  });

  it('removes the file once the rebase has read it', () => {
    const todo = writeTempRebaseTodo('pick abc one\n');
    assert.ok(existsSync(todo.todoPath));
    todo.cleanup();
    assert.equal(existsSync(todo.todoPath), false);
    todo.cleanup();
  });

  it('points git at the file it wrote', () => {
    const todo = writeTempRebaseTodo('pick abc one\n');
    try {
      assert.ok(todo.sequenceEditor.includes(todo.todoPath));
    } finally {
      todo.cleanup();
    }
  });
});
