export interface WorktreeStatusDto {
  dirty: boolean;
  stagedCount: number;
  unstagedCount: number;
}

export type DailyGitWebviewMessage =
  | { type: 'commitStart' }
  | { type: 'checkoutRef'; ref: string };
