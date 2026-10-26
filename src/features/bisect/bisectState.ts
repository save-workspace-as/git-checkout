import * as l10n from '@vscode/l10n';
import type { BisectMark, BisectStateDto } from '../../shared/bisect/bisectProtocol';

export interface BisectTerms {
  bad: string;
  good: string;
}

export interface BisectRefRecord {
  sha: string;
  refname: string;
}

const FIRST_BAD_LINE = /^# first '(?:bad|new)' commit: \[([0-9a-f]{7,40})\]/i;
const MARKED_LINE = /^# (good|bad|skip|old|new): \[([0-9a-f]{7,40})\]/i;

export function normalizeSha(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase() ?? '';
  return /^[0-9a-f]{7,40}$/.test(trimmed) ? trimmed : null;
}

export function parseBisectTerms(text: string): BisectTerms {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    bad: lines[0] || 'bad',
    good: lines[1] || 'good',
  };
}

/** `git bisect good` uses the session's good term (`good` or `old`). */
export function bisectGitTerm(mark: BisectMark, terms: BisectTerms): string {
  if (mark === 'skip') {
    return 'skip';
  }
  if (mark === 'good') {
    return terms.good;
  }
  return terms.bad;
}

export function bisectMarkFromRef(refname: string): BisectMark | null {
  if (!refname.startsWith('refs/bisect/')) {
    return null;
  }
  const leaf = refname.slice('refs/bisect/'.length);
  return termToMark(leaf.split('-')[0] ?? '');
}

export function parseBisectRefLines(stdout: string): BisectRefRecord[] {
  const records: BisectRefRecord[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    const space = trimmed.indexOf(' ');
    if (space <= 0) {
      continue;
    }
    records.push({
      sha: trimmed.slice(0, space),
      refname: trimmed.slice(space + 1).trim(),
    });
  }
  return records;
}

export function bisectCurrentSha(expectedRev: string | null, headSha: string | null): string | null {
  return normalizeSha(expectedRev) ?? normalizeSha(headSha);
}

export function bisectSummary(
  active: boolean,
  currentSha: string | null,
  firstBadSha: string | null,
  onlySkipped = false,
): string {
  if (!active) {
    return '';
  }
  if (firstBadSha) {
    return l10n.t('First bad commit {0}', firstBadSha.slice(0, 7));
  }
  if (onlySkipped) {
    return l10n.t('Only skipped commits left to test');
  }
  if (currentSha) {
    return l10n.t('Testing {0}', currentSha.slice(0, 7));
  }
  return l10n.t('Bisect in progress');
}

export function collectBisectMarks(
  log: string,
  refs: readonly BisectRefRecord[],
): Pick<BisectStateDto, 'good' | 'bad' | 'skip' | 'firstBadSha'> & { onlySkipped: boolean } {
  const good = new Set<string>();
  const bad = new Set<string>();
  const skip = new Set<string>();
  let firstBadSha: string | null = null;
  let onlySkipped = false;

  const add = (mark: BisectMark, sha: string) => {
    if (mark === 'good') {
      good.add(sha);
    } else if (mark === 'bad') {
      bad.add(sha);
    } else {
      skip.add(sha);
    }
  };

  for (const ref of refs) {
    const mark = bisectMarkFromRef(ref.refname);
    const sha = normalizeSha(ref.sha);
    if (mark && sha) {
      add(mark, sha);
    }
  }

  for (const line of log.split(/\r?\n/)) {
    if (line.trim() === '# only skipped commits left to test') {
      onlySkipped = true;
      continue;
    }
    const first = FIRST_BAD_LINE.exec(line.trim());
    if (first) {
      const sha = normalizeSha(first[1]);
      if (sha) {
        firstBadSha = sha;
        bad.add(sha);
      }
      continue;
    }
    const marked = MARKED_LINE.exec(line.trim());
    if (!marked) {
      continue;
    }
    const mark = termToMark(marked[1]);
    const sha = normalizeSha(marked[2]);
    if (mark && sha) {
      add(mark, sha);
    }
  }

  return {
    good: [...good].sort(),
    bad: [...bad].sort(),
    skip: [...skip].sort(),
    firstBadSha,
    onlySkipped,
  };
}

function termToMark(term: string): BisectMark | null {
  switch (term.toLowerCase()) {
    case 'good':
    case 'old':
      return 'good';
    case 'bad':
    case 'new':
      return 'bad';
    case 'skip':
      return 'skip';
    default:
      return null;
  }
}
