export type CommitPatchFormat = 'format-patch' | 'diff';

export type PatchExportOp = 'copy' | 'save';

export type PatchWebviewMessage =
  | {
      type: 'historyPatchExport';
      shas: string[];
      op: PatchExportOp;
      format: CommitPatchFormat;
    }
  | {
      type: 'refsPatchExport';
      base: string;
      compare: string;
      op: PatchExportOp;
      format: CommitPatchFormat;
    }
  | { type: 'historyApplyPatchFromClipboard' };
