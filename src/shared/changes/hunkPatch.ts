import type { CommitDiffLineDto } from '../history/commitDetailsProtocol';

/** How many hunks the diff lines hold. */
export function hunkCount(lines: readonly CommitDiffLineDto[]): number {
  return lines.filter((line) => line.kind === 'hunk').length;
}

/**
 * A patch for one hunk of the diff on screen, so it applies whatever context or whitespace options
 * produced those lines. A hunk that creates or deletes the whole file gets a matching header.
 */
export function buildHunkPatch(
  path: string,
  lines: readonly CommitDiffLineDto[],
  hunkIndex: number,
): string | null {
  let index = -1;
  const body: string[] = [];
  let header = '';
  for (const line of lines) {
    if (line.kind === 'hunk') {
      index += 1;
      if (index === hunkIndex) {
        header = line.text;
      } else if (index > hunkIndex) {
        break;
      }
      continue;
    }
    if (index !== hunkIndex) {
      continue;
    }
    body.push(`${line.kind === 'add' ? '+' : line.kind === 'del' ? '-' : ' '}${line.text}`);
    if (line.noEol) {
      body.push('\\ No newline at end of file');
    }
  }
  if (!header) {
    return null;
  }
  const creates = /^@@ -0,0 /.test(header);
  const deletes = / \+0,0 @@/.test(header);
  const head = [
    `diff --git a/${path} b/${path}`,
    ...(creates ? ['new file mode 100644'] : []),
    ...(deletes ? ['deleted file mode 100644'] : []),
    `--- ${creates ? '/dev/null' : `a/${path}`}`,
    `+++ ${deletes ? '/dev/null' : `b/${path}`}`,
  ];
  return `${[...head, header, ...body].join('\n')}\n`;
}
