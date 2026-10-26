export interface BranchRenameRequest {
  name: string;
  renameRemote: boolean;
}

/** Remote and branch from `branch@{upstream}`, split on the first slash. */
export interface BranchUpstream {
  remote: string;
  branch: string;
}
