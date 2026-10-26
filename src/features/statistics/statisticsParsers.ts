export interface Contributor {
  name: string;
  email: string;
  commits: number;
}

/** Reads `git shortlog -sne`: a count, a tab, then `Name <email>`, most commits first. */
export function parseContributors(output: string): Contributor[] {
  const contributors: Contributor[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(\d+)\t(.*?)\s*(?:<([^>]*)>)?\s*$/.exec(line);
    if (match) {
      contributors.push({ commits: Number(match[1]), name: match[2], email: match[3] ?? '' });
    }
  }
  return contributors;
}

export interface ObjectSizes {
  /** Loose objects plus packs, as Git prints them ("1.2 MiB"). */
  loose: string;
  packed: string;
}

/** Reads `git count-objects -vH`. */
export function parseObjectSizes(output: string): ObjectSizes {
  const value = (key: string): string => new RegExp(`^${key}: (.+)$`, 'm').exec(output)?.[1]?.trim() ?? '0 bytes';
  return { loose: value('size'), packed: value('size-pack') };
}
