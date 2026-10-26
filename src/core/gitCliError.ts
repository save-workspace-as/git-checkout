export type GitCliErrorCode =
  | 'NotReady'
  | 'Lock'
  | 'Timeout'
  | 'Cancelled'
  | 'ExitCode';

export class GitCliError extends Error {
  readonly code: GitCliErrorCode;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly repoRoot: string;

  constructor(
    code: GitCliErrorCode,
    message: string,
    repoRoot: string,
    stderr = '',
    exitCode: number | null = null,
  ) {
    super(message);
    this.name = 'GitCliError';
    this.code = code;
    this.stderr = stderr;
    this.exitCode = exitCode;
    this.repoRoot = repoRoot;
  }
}

export function isGitLockError(stderr: string): boolean {
  const lower = stderr.toLowerCase();
  return (
    lower.includes('index.lock') ||
    lower.includes('shallow.lock') ||
    lower.includes('unable to lock') ||
    lower.includes('file exists')
  );
}
