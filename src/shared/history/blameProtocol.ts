export const BLAME_LINE_BATCH = 2000;

export interface BlameLineDto {
  line: number;
  text: string;
  sha: string;
  author: string;
  authorMail: string;
  authorTime: number;
  summary: string;
  groupStart: boolean;
}

export interface BlameLinesPage {
  lines: BlameLineDto[];
  hasMore: boolean;
}

export function isUncommittedSha(sha: string): boolean {
  return /^0+$/.test(sha);
}
