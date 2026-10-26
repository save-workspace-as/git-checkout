import * as path from 'path';
import * as vscode from 'vscode';
import { buildGitCheckoutBlobUri } from '../../core/gitCheckoutUri';
import type { CommitDiffEndpoints } from '../../shared/history/commitDetails';
import type { WorkingCopyDiffSide } from '../../shared/changes/workingCopyProtocol';

export async function openWorkingCopyInDiffEditor(
  repoRoot: string,
  repoRelativePath: string,
  side: WorkingCopyDiffSide,
): Promise<void> {
  const rel = repoRelativePath.replace(/\\/g, '/');
  const left = vscode.Uri.parse(buildGitCheckoutBlobUri(repoRoot, 'HEAD', rel));
  const right =
    side === 'staged'
      ? vscode.Uri.parse(buildGitCheckoutBlobUri(repoRoot, ':', rel))
      : vscode.Uri.file(path.join(repoRoot, rel));

  const title = `${rel} (${side === 'staged' ? 'staged' : 'working tree'})`;
  await vscode.commands.executeCommand('vscode.diff', left, right, title, { preview: false });
}

/** Opens the parent-to-commit diff for one path, including renames. */
export async function openCommitFileDiff(
  repoRoot: string,
  endpoints: CommitDiffEndpoints,
  title: string,
  options: vscode.TextDocumentShowOptions = { preview: true },
): Promise<void> {
  const left = vscode.Uri.parse(
    buildGitCheckoutBlobUri(repoRoot, endpoints.leftRevision, endpoints.leftPath),
  );
  const right = vscode.Uri.parse(
    buildGitCheckoutBlobUri(repoRoot, endpoints.rightRevision, endpoints.rightPath),
  );
  await vscode.commands.executeCommand('vscode.diff', left, right, title, options);
}
