export interface SubmoduleShaPair {
  oldSha: string;
  newSha: string;
}

const SUBPROJECT_LINE = /^[+-]Subproject commit ([0-9a-f]{7,40})$/;

export function parseSubmoduleShasFromDiffText(diffText: string): SubmoduleShaPair | null {
  let oldSha: string | undefined;
  let newSha: string | undefined;
  for (const line of diffText.split(/\r?\n/)) {
    const match = SUBPROJECT_LINE.exec(line.trim());
    if (!match) {
      continue;
    }
    if (line.startsWith('-')) {
      oldSha = match[1];
    } else if (line.startsWith('+')) {
      newSha = match[1];
    }
  }
  if (!oldSha || !newSha || oldSha === newSha) {
    return null;
  }
  return { oldSha, newSha };
}

export interface SubmoduleCommitLine {
  sha: string;
  subject: string;
}

/** Parses `git log --format=%H%x09%s` lines between two SHAs. */
export function parseSubmoduleLogOutput(stdout: string): SubmoduleCommitLine[] {
  const commits: SubmoduleCommitLine[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const tab = line.indexOf('\t');
    if (tab < 0) {
      continue;
    }
    const sha = line.slice(0, tab).trim();
    const subject = line.slice(tab + 1);
    if (/^[0-9a-f]{7,40}$/i.test(sha)) {
      commits.push({ sha, subject });
    }
  }
  return commits;
}
