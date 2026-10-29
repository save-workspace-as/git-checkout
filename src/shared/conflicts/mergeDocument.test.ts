import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  alignConflict,
  allHaveSide,
  conflictsOf,
  paneRows,
  parseMergeDocument,
  editableText,
  fileText,
  openConflicts,
  isResolved,
  linesTaken,
  unresolved,
  withLineToggled,
  withSideTaken,
  resultLineMap,
  resultOrigins,
  withSide,
  type MergeChoice,
} from './mergeDocument';

const FILE = [
  'one',
  '<<<<<<< HEAD',
  'current a',
  '=======',
  'incoming a',
  'incoming b',
  '>>>>>>> topic',
  'two',
  '<<<<<<< HEAD',
  'current c',
  '=======',
  '>>>>>>> topic',
  'three',
  '',
].join('\n');

/** Whole sides: every line of a side that is on. */
const choices = (...list: [boolean, boolean][]): MergeChoice[] => list.map(([incoming, current]) => ({
  incoming: { taken: incoming, lines: Array(8).fill(incoming) },
  current: { taken: current, lines: Array(8).fill(current) },
}));

describe('parseMergeDocument', () => {
  it('splits a file into shared text and conflicts', () => {
    const document = parseMergeDocument(FILE);
    assert.deepEqual(document.segments, [
      { kind: 'common', lines: ['one'] },
      { kind: 'conflict', current: ['current a'], incoming: ['incoming a', 'incoming b'] },
      { kind: 'common', lines: ['two'] },
      { kind: 'conflict', current: ['current c'], incoming: [] },
      { kind: 'common', lines: ['three'] },
    ]);
    assert.equal(document.finalEol, true);
    assert.equal(conflictsOf(document).length, 2);
  });

  it('reads the common ancestor of a diff3 conflict', () => {
    const [conflict] = conflictsOf(parseMergeDocument('<<<<<<< HEAD\nme\n||||||| base\nold\n=======\nthem\n>>>>>>> topic\n'));
    assert.deepEqual(conflict, { kind: 'conflict', current: ['me'], base: ['old'], incoming: ['them'] });
  });

  it('keeps the line breaks of the file, and whether it ends with one', () => {
    const crlf = parseMergeDocument('a\r\n<<<<<<< HEAD\r\nb\r\n=======\r\nc\r\n>>>>>>> t\r\nd');
    assert.equal(crlf.eol, '\r\n');
    assert.equal(crlf.finalEol, false);
    assert.equal(fileText(crlf, editableText(crlf, choices([true, false]))), 'a\r\nc\r\nd');
  });

  it('leaves a marker that is not part of a closed conflict as text', () => {
    for (const broken of [
      'a\n<<<<<<< HEAD\nb\n',
      'a\n<<<<<<< HEAD\nb\n=======\nc\n',
      'a\n<<<<<<< HEAD\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> t\n',
    ]) {
      const document = parseMergeDocument(broken);
      assert.equal(openConflicts(editableText(document, choices(...conflictsOf(document).map((): [boolean, boolean] => [true, true])))), 0, broken);
    }
    assert.equal(conflictsOf(parseMergeDocument('a\n<<<<<<< HEAD\nb\n')).length, 0);
    // The inner, closed conflict is still found.
    assert.equal(conflictsOf(parseMergeDocument('<<<<<<< HEAD\n<<<<<<< HEAD\nb\n=======\nc\n>>>>>>> t\n')).length, 1);
  });

  it('has no conflicts in a file without markers', () => {
    assert.deepEqual(conflictsOf(parseMergeDocument('plain\ntext\n')), []);
    assert.deepEqual(conflictsOf(parseMergeDocument('')), []);
  });
});

describe('result of the choices', () => {
  const document = parseMergeDocument(FILE);

  it('takes the incoming side, the current side, or both with the incoming side first', () => {
    assert.equal(editableText(document, choices([true, false], [false, true])), 'one\nincoming a\nincoming b\ntwo\ncurrent c\nthree\n');
    assert.equal(editableText(document, choices([false, true], [true, false])), 'one\ncurrent a\ntwo\nthree\n');
    assert.equal(editableText(document, choices([true, true], [true, true])), 'one\nincoming a\nincoming b\ncurrent a\ntwo\ncurrent c\nthree\n');
  });

  it('is empty when nothing is left', () => {
    const only = parseMergeDocument('<<<<<<< HEAD\n=======\nx\n>>>>>>> t\n');
    assert.equal(editableText(only, choices([false, true])), '');
  });
});

describe('resultLineMap', () => {
  const document = parseMergeDocument(FILE);

  it('maps each pane row to the result line at the same place', () => {
    // Rows: one | a-conflict (2 rows) | two | c-conflict (1 row) | three.
    assert.deepEqual(resultLineMap(document, choices([true, false], [false, true]), paneRows(document)), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(resultLineMap(document, choices([false, true], [true, false]), paneRows(document)), [0, 1, 1, 2, 3, 3]);
  });

  it('spans the markers of a conflict that is still open', () => {
    assert.deepEqual(resultLineMap(document, choices([false, false], [false, false]), paneRows(document)), [0, 1, 2, 7, 8, 12]);
  });
});

describe('paneRows', () => {
  it('shows shared text on both sides and pads a conflict to its taller side', () => {
    const rows = paneRows(parseMergeDocument(FILE));
    assert.deepEqual(rows.map((row) => [row.left?.text, row.right?.text, row.conflict, row.first]), [
      ['one', 'one', undefined, undefined],
      ['incoming a', 'current a', 0, true],
      ['incoming b', undefined, 0, undefined],
      ['two', 'two', undefined, undefined],
      [undefined, 'current c', 1, true],
      ['three', 'three', undefined, undefined],
    ]);
  });

  it('numbers the lines of each side on its own', () => {
    const rows = paneRows(parseMergeDocument(FILE));
    assert.deepEqual(rows.map((row) => [row.left?.line, row.right?.line]), [
      [1, 1], [2, 2], [3, undefined], [4, 3], [undefined, 4], [5, 5],
    ]);
  });
});

describe('choosing a side for every conflict', () => {
  it('sets one side everywhere and says when it is set everywhere', () => {
    const none = choices([false, false], [false, false]);
    const left = withSide(none, 'incoming', true);
    assert.deepEqual(left, choices([true, false], [true, false]));
    assert.equal(allHaveSide(left, 'incoming'), true);
    assert.equal(allHaveSide(left, 'current'), false);
    assert.equal(allHaveSide([], 'incoming'), false);
    assert.equal(left.filter(isResolved).length, 2);
    assert.equal(withSide(left, 'incoming', false).filter(isResolved).length, 0);
  });
});

describe('editableText', () => {
  const document = parseMergeDocument('one\n<<<<<<< HEAD\ncurrent a\n=======\nincoming a\n>>>>>>> topic\ntwo\n');
  it('keeps the markers of a conflict with no side chosen, and replaces them once one is', () => {
    assert.equal(editableText(document, choices([false, false])), 'one\n<<<<<<<\ncurrent a\n=======\nincoming a\n>>>>>>>\ntwo\n');
    assert.equal(openConflicts(editableText(document, choices([false, false]))), 1);
    assert.equal(editableText(document, choices([true, true])), 'one\nincoming a\ncurrent a\ntwo\n');
    assert.equal(openConflicts(editableText(document, choices([true, false]))), 0);
  });
  it('gives the text the file\'s line breaks back', () => {
    const crlf = parseMergeDocument('a\r\n<<<<<<< HEAD\r\nb\r\n=======\r\nc\r\n>>>>>>> t\r\n');
    assert.equal(fileText(crlf, editableText(crlf, choices([false, true]))), 'a\r\nb\r\n');
    assert.equal(fileText(document, 'x\ny\n'), 'x\ny\n');
  });
});

describe('resultOrigins', () => {
  it('says which side each line of the result came from, and which lines are an open conflict', () => {
    const document = parseMergeDocument(FILE);
    const [first] = conflictsOf(document);
    const taken = withLineToggled(unresolved(first), 'incoming', 1);
    assert.deepEqual(resultOrigins(document, [taken, unresolved(conflictsOf(document)[1])]),
      ['common', 'incoming', 'common', 'open', 'open', 'open', 'open', 'common']);
  });
});

describe('alignConflict', () => {
  const conflictOf = (current: string[], incoming: string[]) =>
    conflictsOf(parseMergeDocument(`<<<<<<< HEAD\n${current.join('\n')}\n=======\n${incoming.join('\n')}\n>>>>>>> t\n`))[0];

  it('puts the lines both sides have on one row and pairs the lines only one side has', () => {
    const rows = alignConflict(conflictOf(['a', 'x', 'b', 'c'], ['a', 'b', 'y', 'z', 'c']));
    assert.deepEqual(rows, [
      { incoming: 0, current: 0 },
      { current: 1 },
      { incoming: 1, current: 2 },
      { incoming: 2 },
      { incoming: 3 },
      { incoming: 4, current: 3 },
    ]);
  });

  it('marks the lines only one side has as changed in the pane rows', () => {
    const document = parseMergeDocument('<<<<<<< HEAD\nsame\nnew\n=======\nold\nsame\n>>>>>>> t\n');
    const rows = paneRows(document);
    assert.deepEqual(rows.map((row) => [row.left?.text, row.left?.changed === true, row.right?.text, row.right?.changed === true]), [
      ['old', true, undefined, false],
      ['same', false, 'same', false],
      [undefined, false, 'new', true],
    ]);
  });
});

describe('paneRows with the whole files of both sides', () => {
  // The base is a b c d e f. Ours changed b and d, theirs changed d and f: only d is a conflict.
  const merged = parseMergeDocument('a\nB1\nc\n<<<<<<< HEAD\nD1\n=======\nD2\n>>>>>>> t\ne\nF2\n');
  const sides = { ours: ['a', 'B1', 'c', 'D1', 'e', 'f'], theirs: ['a', 'b', 'c', 'D2', 'e', 'F2'] };
  const view = (rows: ReturnType<typeof paneRows>) => rows.map((row) => [row.left?.text ?? '', row.right?.text ?? '', row.conflict ?? -1]);

  it('shows each side as its whole file, with the lines only one side has on rows of their own', () => {
    const rows = paneRows(merged, sides);
    assert.deepEqual(view(rows), [
      ['a', 'a', -1],
      ['', 'B1', -1],
      ['b', '', -1],
      ['c', 'c', -1],
      ['D2', 'D1', 0],
      ['e', 'e', -1],
      ['F2', '', -1],
      ['', 'f', -1],
    ]);
    assert.deepEqual(rows.map((row) => [row.left?.line, row.right?.line]), [
      [1, 1], [undefined, 2], [2, undefined], [3, 3], [4, 4], [5, 5], [6, undefined], [undefined, 6],
    ], 'each line has its number in its own file');
    assert.deepEqual(rows.map((row) => [row.left?.changed === true, row.right?.changed === true]), [
      [false, false], [false, true], [true, false], [false, false], [true, true], [false, false], [true, false], [false, true],
    ]);
  });

  it('keeps the rows of the conflict wired to its choices', () => {
    const rows = paneRows(merged, sides);
    const conflictRow = rows.find((row) => row.conflict === 0)!;
    assert.deepEqual([conflictRow.first, conflictRow.incomingIndex, conflictRow.currentIndex], [true, 0, 0]);
    // The rows map to the lines of the result: the conflict's, and the lines of the files that are not in the merged file.
    const map = resultLineMap(merged, [withSideTaken(unresolved(conflictsOf(merged)[0]), 'incoming', true)], rows);
    assert.deepEqual(map, [0, 1, 2, 2, 3, 4, 5, 5]);
  });

  it('falls back to the merged file when the files cannot be matched to it', () => {
    const rows = paneRows(merged, { ours: ['nothing', 'like', 'it'], theirs: ['nothing', 'like', 'it'] });
    assert.deepEqual(view(rows).map((row) => row[0]).slice(0, 4), ['a', 'B1', 'c', 'D2']);
  });
});

describe('choosing single lines', () => {
  const [conflict] = conflictsOf(parseMergeDocument('<<<<<<< HEAD\ncurrent a\n=======\nincoming a\nincoming b\n>>>>>>> t\n'));

  it('starts with nothing taken, and takes a side line by line', () => {
    const none = unresolved(conflict);
    assert.equal(isResolved(none), false);
    const one = withLineToggled(none, 'incoming', 1);
    assert.equal(isResolved(one), true);
    assert.deepEqual(linesTaken(one.incoming, conflict.incoming), ['incoming b']);
    assert.deepEqual(linesTaken(one.current, conflict.current), []);
    const both = withLineToggled(one, 'incoming', 0);
    assert.deepEqual(linesTaken(both.incoming, conflict.incoming), ['incoming a', 'incoming b']);
  });

  it('gives the side back once its last line is taken off, and a whole side takes or gives all of it', () => {
    const one = withLineToggled(unresolved(conflict), 'current', 0);
    assert.equal(isResolved(withLineToggled(one, 'current', 0)), false);
    const all = withSideTaken(unresolved(conflict), 'incoming', true);
    assert.deepEqual(linesTaken(all.incoming, conflict.incoming), ['incoming a', 'incoming b']);
    assert.deepEqual(linesTaken(withSideTaken(all, 'incoming', false).incoming, conflict.incoming), []);
  });

  it('puts only the taken lines in the result, the incoming ones first', () => {
    const document = parseMergeDocument('x\n<<<<<<< HEAD\ncurrent a\n=======\nincoming a\nincoming b\n>>>>>>> t\ny\n');
    const choice = withLineToggled(withLineToggled(unresolved(conflictsOf(document)[0]), 'current', 0), 'incoming', 1);
    assert.equal(editableText(document, [choice]), 'x\nincoming b\ncurrent a\ny\n');
    assert.deepEqual(resultLineMap(document, [choice], paneRows(document)), [0, 1, 2, 3]);
  });

  it('can take nothing from a side that has no lines, and still counts as chosen', () => {
    const [removed] = conflictsOf(parseMergeDocument('<<<<<<< HEAD\ngone soon\n=======\n>>>>>>> t\n'));
    const choice = withSideTaken(unresolved(removed), 'incoming', true);
    assert.equal(isResolved(choice), true);
  });
});
