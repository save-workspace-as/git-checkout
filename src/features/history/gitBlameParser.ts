const SHA_HEADER = /^([0-9a-f]{4,64}) (\d+) (\d+)/i;

export interface BlameLine {
  sha: string;
  originalLine: number;
  finalLine: number;
  author: string;
  authorMail: string;
  authorTime: number;
  summary: string;
  path: string;
  text: string;
  previousSha?: string;
  previousPath?: string;
}

interface CommitMeta {
  author: string;
  authorMail: string;
  authorTime: number;
  summary: string;
  path: string;
  previousSha?: string;
  previousPath?: string;
}

function blankMeta(): CommitMeta {
  return { author: '', authorMail: '', authorTime: 0, summary: '', path: '' };
}

function stripMail(value: string): string {
  const match = /^<(.*)>$/.exec(value.trim());
  return match ? match[1] : value.trim();
}

function applyField(meta: CommitMeta | undefined, key: string, value: string): CommitMeta {
  const next = meta ?? blankMeta();
  switch (key) {
    case 'author':
      next.author = value;
      break;
    case 'author-mail':
      next.authorMail = stripMail(value);
      break;
    case 'author-time':
      next.authorTime = Number.parseInt(value, 10) || 0;
      break;
    case 'summary':
      next.summary = value;
      break;
    case 'filename':
      next.path = value;
      break;
    case 'previous': {
      const split = value.indexOf(' ');
      next.previousSha = split === -1 ? value : value.slice(0, split);
      next.previousPath = split === -1 ? undefined : value.slice(split + 1);
      break;
    }
    default:
      break;
  }
  return next;
}

/** Parses `git blame --porcelain`, including abbreviated headers for repeated commits. */
export function parseGitBlame(output: string): BlameLine[] {
  if (!output.trim()) {
    return [];
  }
  const rows = output.split('\n');
  const commits = new Map<string, CommitMeta>();
  const lines: BlameLine[] = [];
  let index = 0;

  while (index < rows.length) {
    const header = rows[index]?.replace(/\r$/, '') ?? '';
    if (!header) {
      index++;
      continue;
    }
    const match = SHA_HEADER.exec(header);
    if (!match) {
      throw new Error(`Unrecognized blame header: ${header.slice(0, 80)}`);
    }
    const sha = match[1];
    const originalLine = Number(match[2]);
    const finalLine = Number(match[3]);
    index++;

    let meta = commits.get(sha);
    while (index < rows.length) {
      const field = rows[index]?.replace(/\r$/, '') ?? '';
      if (field === '' || field.startsWith('\t') || SHA_HEADER.test(field)) {
        break;
      }
      const space = field.indexOf(' ');
      const key = space === -1 ? field : field.slice(0, space);
      const value = space === -1 ? '' : field.slice(space + 1);
      meta = applyField(meta, key, value);
      index++;
    }
    meta ??= blankMeta();
    commits.set(sha, meta);

    let text = '';
    const content = rows[index]?.replace(/\r$/, '') ?? '';
    if (content.startsWith('\t')) {
      text = content.slice(1);
      index++;
    }

    lines.push({
      sha,
      originalLine,
      finalLine,
      author: meta.author,
      authorMail: meta.authorMail,
      authorTime: meta.authorTime,
      summary: meta.summary,
      path: meta.path,
      text,
      previousSha: meta.previousSha,
      previousPath: meta.previousPath,
    });
  }

  return lines;
}
