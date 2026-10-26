import * as path from 'node:path';

export type ArchiveFormat = 'zip' | 'tar.gz' | 'tar';

/** The archive type a file name asks for; anything unknown is a zip. */
export function archiveFormat(file: string): ArchiveFormat {
  const name = file.toLowerCase();
  if (name.endsWith('.tar.gz') || name.endsWith('.tgz')) { return 'tar.gz'; }
  return name.endsWith('.tar') ? 'tar' : 'zip';
}

/** `git archive` of `ref` into `file`, with every entry under a folder named after the repository. */
export function archiveArgs(ref: string, file: string, folder: string): string[] {
  return ['archive', `--format=${archiveFormat(file)}`, `--prefix=${folder}/`, '-o', file, ref];
}

export function defaultArchiveName(repoRoot: string, ref: string): string {
  const safe = ref.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'archive';
  return `${path.basename(repoRoot)}-${safe}.zip`;
}
