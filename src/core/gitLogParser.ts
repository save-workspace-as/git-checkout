import type { GraphCommitDto, GraphRefDto } from '../shared/graph/graphProtocol';

const FIELDS_PER_COMMIT = 7;

/**
 * Parses `%D` output from `git log --decorate=full`, e.g.
 * `HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1`.
 */
export function parseRefDecorations(raw: string): GraphRefDto[] {
  const refs: GraphRefDto[] = [];
  for (const part of raw.split(',')) {
    let item = part.trim();
    if (!item) {
      continue;
    }
    let isHead = false;
    if (item.startsWith('HEAD -> ')) {
      isHead = true;
      item = item.slice('HEAD -> '.length);
    } else if (item === 'HEAD') {
      refs.push({ kind: 'head', name: 'HEAD' });
      continue;
    }
    if (item.startsWith('tag: ')) {
      item = item.slice('tag: '.length);
    }

    if (item.startsWith('refs/heads/')) {
      const name = item.slice('refs/heads/'.length);
      refs.push(isHead ? { kind: 'local', name, isHead } : { kind: 'local', name });
    } else if (item.startsWith('refs/remotes/')) {
      const name = item.slice('refs/remotes/'.length);
      if (!name.endsWith('/HEAD')) {
        refs.push({ kind: 'remote', name });
      }
    } else if (item.startsWith('refs/tags/')) {
      refs.push({ kind: 'tag', name: item.slice('refs/tags/'.length) });
    } else if (item === 'refs/stash') {
      refs.push({ kind: 'stash', name: 'stash' });
    }
  }
  return refs;
}

export function parseGitLog(output: string): GraphCommitDto[] {
  const tokens = output.split('\0');
  const commits: GraphCommitDto[] = [];

  for (let i = 0; i + FIELDS_PER_COMMIT - 1 < tokens.length; i += FIELDS_PER_COMMIT) {
    const sha = tokens[i]?.trim();
    if (!sha) {
      continue;
    }
    const parentsRaw = tokens[i + 1]?.trim() ?? '';
    commits.push({
      sha,
      parents: parentsRaw ? parentsRaw.split(/\s+/).filter(Boolean) : [],
      subject: tokens[i + 2] ?? '',
      author: tokens[i + 3] ?? '',
      authorEmail: tokens[i + 4] ?? '',
      authorDate: Number.parseInt(tokens[i + 5] ?? '0', 10) || 0,
      refs: parseRefDecorations(tokens[i + 6] ?? ''),
    });
  }

  return commits;
}
