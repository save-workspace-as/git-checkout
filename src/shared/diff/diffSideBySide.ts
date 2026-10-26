import type { WorkingCopyDiffLineDto } from '../changes/workingCopyProtocol';

export type SideBySideCellKind = 'context' | 'add' | 'del' | 'empty';

export interface SideBySideCell {
  text: string;
  kind: SideBySideCellKind;
  line?: WorkingCopyDiffLineDto;
}

export interface SideBySideRow {
  left: SideBySideCell;
  right: SideBySideCell;
}

export function buildSideBySideRows(lines: WorkingCopyDiffLineDto[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  const pendingDel: WorkingCopyDiffLineDto[] = [];

  const flushPending = (): void => {
    for (const del of pendingDel) {
      rows.push({
        left: cellFromLine(del),
        right: emptyCell(),
      });
    }
    pendingDel.length = 0;
  };

  for (const line of lines) {
    if (line.kind === 'del') {
      pendingDel.push(line);
      continue;
    }
    if (line.kind === 'add') {
      const del = pendingDel.shift();
      rows.push({
        left: del ? cellFromLine(del) : emptyCell(),
        right: cellFromLine(line),
      });
      continue;
    }
    flushPending();
    rows.push({
      left: cellFromLine(line),
      right: cellFromLine(line),
    });
  }
  flushPending();
  return rows;
}

function cellFromLine(line: WorkingCopyDiffLineDto): SideBySideCell {
  return { text: line.text, kind: line.kind, line };
}

function emptyCell(): SideBySideCell {
  return { text: '', kind: 'empty' };
}

export function formatVisibleWhitespace(text: string): string {
  return text.replace(/\t/g, '→').replace(/ /g, '·');
}
