import type { BranchCreateRequest } from './branchCreate';
import type { BranchRenameRequest } from './branchRename';

export interface RefBranchDto {
  name: string;
  shortSha: string;
  upstream: string | null;
  upstreamTrack: string | null;
  isHead: boolean;
}

export interface RefRemoteBranchDto {
  name: string;
  shortSha: string;
  remote: string;
}

export interface RefTagDto {
  name: string;
  shortSha: string;
  kind: 'annotated' | 'lightweight';
}

export interface RefRemoteDto {
  name: string;
  urls: string[];
}

export interface RefsSnapshotDto {
  branches: RefBranchDto[];
  remoteBranches: RefRemoteBranchDto[];
  tags: RefTagDto[];
  remotes: RefRemoteDto[];
  filterRef: string;
  headRef: string | null;
}

export interface RefsCompareResultDto {
  base: string;
  compare: string;
  leftCount: number;
  rightCount: number;
  logPreview: string;
  diffStat: string;
}

export interface AddRemoteRequest {
  name: string;
  url: string;
}

export type RefsMutateOp =
  | { op: 'branchCreate'; startRef?: string; request?: BranchCreateRequest }
  | { op: 'branchDelete'; name: string }
  | { op: 'remoteBranchDelete'; name: string }
  | { op: 'branchRename'; name: string; request?: BranchRenameRequest }
  | { op: 'tagCreateLight'; objectRef?: string }
  | { op: 'tagCreateAnnotated'; objectRef?: string }
  | { op: 'tagDelete'; name: string }
  | { op: 'remoteAdd'; request?: AddRemoteRequest }
  | { op: 'remoteEdit'; name: string }
  | { op: 'remoteRemove'; name: string }
  | { op: 'branchSetUpstream'; name: string }
  | { op: 'branchUnsetUpstream'; name: string };

export type RefsHostMessage = { type: 'refsCompareResult'; result: RefsCompareResultDto };
