export type SubmoduleCheckoutStatus = 'ok' | 'modified' | 'uninitialized' | 'conflict';

export interface GitSubmoduleDto {
  /** Path relative to the superproject, using `/` separators. */
  path: string;
  sha: string;
  describe: string | null;
  status: SubmoduleCheckoutStatus;
  absolutePath: string;
}
