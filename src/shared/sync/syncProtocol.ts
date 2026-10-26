export interface SyncStatusDto {
  ahead: number | null;
  behind: number | null;
  upstream: string | null;
  busy: boolean;
}

export type SyncWebviewMessage =
  | { type: 'syncFetch' }
  | { type: 'syncPull' }
  | { type: 'syncPush' }
  | { type: 'syncPushForceWithLease' };
