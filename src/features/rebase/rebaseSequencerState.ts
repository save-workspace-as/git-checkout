import * as l10n from '@vscode/l10n';
import * as fs from 'fs';
import * as path from 'path';
import { commitLinesOnly, parseRebaseTodo, type RebaseTodoLine } from './rebaseTodo';

export interface RebaseSequencerSnapshot {
  active: boolean;
  onto: string | null;
  headName: string | null;
  msgnum: number;
  end: number;
  remaining: RebaseTodoLine[];
  done: RebaseTodoLine[];
  summary: string;
}

function readTrimmed(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
}

export function readRebaseSequencerState(gitDir: string): RebaseSequencerSnapshot | null {
  const mergeDir = path.join(gitDir, 'rebase-merge');
  if (!fs.existsSync(mergeDir)) {
    const applyDir = path.join(gitDir, 'rebase-apply');
    if (!fs.existsSync(applyDir)) {
      return null;
    }
    const headName = readTrimmed(path.join(applyDir, 'head-name'));
    return {
      active: true,
      onto: null,
      headName,
      msgnum: 0,
      end: 0,
      remaining: [],
      done: [],
      summary: l10n.t('Rebase in progress'),
    };
  }

  const todoRaw = readTrimmed(path.join(mergeDir, 'git-rebase-todo')) ?? '';
  const doneRaw = readTrimmed(path.join(mergeDir, 'done')) ?? '';
  const onto = readTrimmed(path.join(mergeDir, 'onto'));
  const headName = readTrimmed(path.join(mergeDir, 'head-name'));
  const msgnum = Number.parseInt(readTrimmed(path.join(mergeDir, 'msgnum')) ?? '0', 10) || 0;
  const end = Number.parseInt(readTrimmed(path.join(mergeDir, 'end')) ?? '0', 10) || 0;

  const remaining = parseRebaseTodo(todoRaw);
  const done = parseRebaseTodo(doneRaw);
  const doneCount = commitLinesOnly(done).length;
  const total = end > 0 ? end : doneCount + commitLinesOnly(remaining).length;
  const current = msgnum > 0 ? msgnum : doneCount;

  const summary =
    total > 0
      ? l10n.t('Rebase step {0} of {1}', Math.min(current, total), total)
      : l10n.t('Interactive rebase in progress');

  return {
    active: true,
    onto,
    headName,
    msgnum: current,
    end: total,
    remaining,
    done,
    summary,
  };
}
