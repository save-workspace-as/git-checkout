import * as l10n from '@vscode/l10n';
import { validateBranchName, validateStartPoint } from '../features/branches/branchCreate';
import type { BranchUpstream } from '../shared/branches/branchRename';
import type { RefsSnapshotDto } from '../shared/branches/refsProtocol';
import { isSafeGitToken } from '../features/sync/pullOptions';
import {
  normalizeWorktreeCreateRequest, suggestWorktreePath, validateNewWorktreeBranch,
  validateWorktreeCreate, validateWorktreeDestination, type WorktreeCreateContext,
} from '../features/worktrees/worktreeCreate';
import { branchNameInputFrom, type BranchNamePrefill } from '../shared/branches/branchCreate';
import type { OperationFormDefinition, OperationFormErrors, OperationFormValues } from '../shared/forms/operationForm';
import type { WorktreeCreateRequest } from '../shared/worktrees/worktreeProtocol';
import type { StashEntryDto } from '../shared/stash/stashProtocol';
import { validateGitFlowInit, type GitFlowInitConfig } from '../features/gitflow/gitFlowGuide';
import { validateSubmoduleAdd, type SubmoduleAddRequest } from '../features/submodules/submoduleAdd';

export const MERGE_TYPE_DEFAULT = l10n.t('Default');
export const MERGE_TYPE_FAST_FORWARD = l10n.t('Fast-forward if possible');

export function gitFlowInitForm(defaults: GitFlowInitConfig, branchNames: readonly string[]): OperationFormDefinition {
  return {
    title: l10n.t('Initialize Git Flow'),
    submitLabel: l10n.t('Initialize'),
    values: { ...defaults },
    fields: [
      {
        id: 'production', type: 'text', label: l10n.t('Production branch'), required: true,
        description: l10n.t('The branch that holds released work.'),
        suggestions: branchNames.map((value) => ({ value })),
      },
      { id: 'develop', type: 'text', label: l10n.t('Development branch'), required: true,
        description: l10n.t('The branch that holds ongoing work.') },
      { id: 'featurePrefix', type: 'text', label: l10n.t('Feature prefix'), required: true,
        description: l10n.t('The start of a new feature branch name.') },
      { id: 'releasePrefix', type: 'text', label: l10n.t('Release prefix'), required: true,
        description: l10n.t('The start of a release branch name.') },
      { id: 'hotfixPrefix', type: 'text', label: l10n.t('Hotfix prefix'), required: true,
        description: l10n.t('The start of a hotfix branch name.') },
      { id: 'versionTagPrefix', type: 'text', label: l10n.t('Version tag prefix'),
        description: l10n.t('The start of a version tag. Leave it empty for none.') },
    ],
  };
}

export function gitFlowInitFromValues(values: OperationFormValues): GitFlowInitConfig {
  return {
    production: String(values.production),
    develop: String(values.develop),
    featurePrefix: String(values.featurePrefix),
    releasePrefix: String(values.releasePrefix),
    hotfixPrefix: String(values.hotfixPrefix),
    versionTagPrefix: String(values.versionTagPrefix),
  };
}

export function validateGitFlowInitForm(
  values: OperationFormValues,
  branchNames: readonly string[],
): OperationFormErrors {
  return validateGitFlowInit(gitFlowInitFromValues(values), branchNames);
}

export function applyStashForm(stash: StashEntryDto): OperationFormDefinition {
  return {
    title: l10n.t('Apply Stash'),
    submitLabel: l10n.t('Apply'),
    values: { stash: `${stash.selector} ${stash.message}`, deleteAfter: false },
    fields: [
      { id: 'stash', type: 'text', label: l10n.t('Stash'), readOnly: true,
        description: l10n.t('The stash entry to apply.') },
      { id: 'deleteAfter', type: 'checkbox', label: l10n.t('Drop stash after applying') },
    ],
  };
}

export function renameStashForm(stash: StashEntryDto): OperationFormDefinition {
  return {
    title: l10n.t('Rename Stash'),
    submitLabel: l10n.t('Rename'),
    values: { message: stash.message },
    fields: [{
      id: 'message', type: 'text', label: l10n.t('Message'), required: true,
      description: l10n.t('This feature is experimental; use it with caution.'),
    }],
  };
}

export function deleteStashForm(stash: StashEntryDto): OperationFormDefinition {
  return {
    title: l10n.t('Drop Stash'),
    submitLabel: l10n.t('Delete'),
    values: { stash: `${stash.selector} ${stash.message}` },
    fields: [{ id: 'stash', type: 'text', label: l10n.t('Stash'), readOnly: true,
      description: l10n.t('The stash entry to drop.') }],
  };
}

export function mergeForm(
  source: string,
  target: string,
  wouldConflict: boolean,
): OperationFormDefinition {
  return {
    title: l10n.t('Merge'),
    ...(wouldConflict
      ? { notice: { kind: 'warning' as const, message: l10n.t('Merge will cause conflicts') } }
      : {}),
    submitLabel: l10n.t('Merge'),
    values: { source, target, mergeType: MERGE_TYPE_FAST_FORWARD },
    fields: [
      { id: 'source', type: 'text', label: l10n.t('Merge'), readOnly: true,
        description: l10n.t('The branch to merge.') },
      { id: 'target', type: 'text', label: l10n.t('Into'), readOnly: true,
        description: l10n.t('The branch that receives the merged commits.') },
      {
        id: 'mergeType', type: 'text', label: l10n.t('Merge type'), required: true,
        description: l10n.t('How Git combines the two branches.'),
        suggestions: [
          { value: MERGE_TYPE_DEFAULT },
          { value: MERGE_TYPE_FAST_FORWARD },
        ],
      },
    ],
  };
}

export function resetForm(branch: string, target: string): OperationFormDefinition {
  return {
    title: l10n.t('Reset Current Branch to Revision'),
    submitLabel: l10n.t('Reset'),
    values: { branch, target, mode: 'mixed' },
    fields: [
      { id: 'branch', type: 'text', label: l10n.t('Branch'), readOnly: true,
        description: l10n.t('The branch whose head moves.') },
      {
        id: 'target', type: 'text', label: l10n.t('Move to'), readOnly: true,
        description: l10n.t("Move the '{0}' branch head to this revision", branch),
      },
      {
        id: 'mode', type: 'radio', label: l10n.t('Reset type'),
        options: [
          { value: 'soft', label: l10n.t('Soft: keep all changes, stage differences') },
          { value: 'mixed', label: l10n.t('Mixed: keep all changes, unstage differences') },
          { value: 'hard', label: l10n.t('Hard: discard all local changes') },
        ],
      },
    ],
  };
}

/** Edit Commit Message: the commit it is for, with the whole message to change. */
export function editCommitMessageForm(sha: string, subject: string, message: string, pushedTo: readonly string[]): OperationFormDefinition {
  return {
    title: l10n.t('Edit Commit Message'),
    submitLabel: l10n.t('Edit Message'),
    ...(pushedTo.length > 0
      ? { notice: { kind: 'warning' as const, message: l10n.t("'{0}' already has this commit. Editing it rewrites history, so the branch needs a force push.", pushedTo[0]) } }
      : {}),
    values: { commit: `${sha.slice(0, 7)} ${subject}`, message },
    fields: [
      { id: 'commit', type: 'text', label: l10n.t('Commit'), readOnly: true,
        description: l10n.t('The commit whose message changes. Its author, date and changes stay the same.') },
      { id: 'message', type: 'text', label: l10n.t('Message'), multiline: true, required: true,
        description: l10n.t('The subject, then a blank line, then the body.') },
    ],
  };
}

export function rebaseForm(
  source: string,
  target: string,
  wouldConflict: boolean,
): OperationFormDefinition {
  return {
    title: l10n.t('Rebase'),
    notice: wouldConflict
      ? { kind: 'warning', message: l10n.t('Rebase may cause conflicts') }
      : { kind: 'success', message: l10n.t('Rebase can complete without conflicts') },
    submitLabel: l10n.t('Rebase'),
    values: { source, target, updateDependentBranches: false, stashAndReapply: false },
    fields: [
      { id: 'source', type: 'text', label: l10n.t('Rebase'), readOnly: true,
        description: l10n.t('The branch to rebase.') },
      { id: 'target', type: 'text', label: l10n.t('On'), readOnly: true,
        description: l10n.t('The revision these commits are replayed onto.') },
      { id: 'updateDependentBranches', type: 'checkbox', group: l10n.t('Options'), label: l10n.t('Update dependent branches') },
      { id: 'stashAndReapply', type: 'checkbox', group: l10n.t('Options'), label: l10n.t('Stash and reapply local changes') },
    ],
  };
}

export function tagDetailsForm(tag: string, message: string): OperationFormDefinition {
  return {
    title: l10n.t('Tag Details'),
    submitLabel: l10n.t('Close'),
    values: { tag, message },
    fields: [
      { id: 'tag', type: 'text', label: l10n.t('Tag'), readOnly: true,
        description: l10n.t('The tag these details describe.') },
      {
        id: 'message', type: 'text', label: l10n.t('Message'), multiline: true, readOnly: true,
        description: l10n.t('Message of this annotated tag'),
      },
    ],
  };
}

export interface WorktreeFormContext extends WorktreeCreateContext {
  currentBranch: string | null;
  refs: readonly string[];
  prefill?: BranchNamePrefill;
  existingBranch?: string;
  /** Put in place of whitespace typed into the branch name. */
  whitespaceReplacement?: string;
}

export function worktreeCreateForm(context: WorktreeFormContext): OperationFormDefinition {
  const location = {
    id: 'path', type: 'text', label: l10n.t('Location'), required: true, pickLabel: l10n.t('Choose folder'),
    description: l10n.t('The folder for this worktree.'),
  } as const;
  if (context.existingBranch !== undefined) {
    return {
      title: l10n.t('Checkout Branch as Worktree'),
      submitLabel: l10n.t('Create'),
      values: {
        startPoint: context.existingBranch,
        path: suggestWorktreePath(context.repoRoot, context.existingBranch),
      },
      fields: [
        { id: 'startPoint', type: 'text', label: l10n.t('Local branch'), readOnly: true,
          description: l10n.t('The local branch to check out in this worktree.') },
        location,
      ],
    };
  }
  const startPoint = context.currentBranch || 'HEAD';
  const newBranch = branchNameInputFrom(context.prefill).value;
  return {
    title: l10n.t('Create Worktree'),
    submitLabel: l10n.t('Create'),
    values: {
      startPoint, newBranch, path: suggestWorktreePath(context.repoRoot, newBranch.trim() || startPoint),
    },
    fields: [
      {
        id: 'startPoint', type: 'text', label: l10n.t('Start at'), required: true,
        description: l10n.t('The revision the new worktree starts from.'),
        suggestions: [...new Set(['HEAD', ...context.branchNames, ...context.refs])].map((value) => ({ value })),
      },
      {
        id: 'newBranch', type: 'text', label: l10n.t('Branch name'), placeholder: l10n.t('Enter branch name'),
        description: l10n.t('The name of the new branch.'),
        replaceWhitespace: context.whitespaceReplacement ?? '-',
      },
      location,
    ],
  };
}

export function worktreeFormRequest(values: OperationFormValues, context: WorktreeFormContext): WorktreeCreateRequest {
  return normalizeWorktreeCreateRequest({
    path: String(values.path),
    startPoint: String(values.startPoint),
    newBranch: context.existingBranch === undefined ? String(values.newBranch) : undefined,
  }, context.repoRoot);
}

export function validateWorktreeForm(values: OperationFormValues, context: WorktreeFormContext): OperationFormErrors {
  const errors: OperationFormErrors = {};
  const destination = validateWorktreeDestination(context.repoRoot, String(values.path), context.worktrees);
  if (destination) { errors.path = destination; }
  if (context.existingBranch === undefined) {
    const branch = validateNewWorktreeBranch(String(values.newBranch), context.branchNames);
    if (branch) { errors.newBranch = branch; }
  }
  const problem = validateWorktreeCreate(worktreeFormRequest(values, context), context);
  if (problem && !errors.path && !errors.newBranch) { errors.startPoint = problem; }
  return errors;
}

export function tagCreateForm(objectRef: string, annotated: boolean): OperationFormDefinition {
  return {
    title: l10n.t('Create Tag'),
    submitLabel: l10n.t('Create Tag'),
    values: annotated
      ? { name: '', objectRef, message: '', pushAllRemotes: false }
      : { name: '', objectRef },
    fields: [
      { id: 'objectRef', type: 'text', label: l10n.t('Create tag at'), readOnly: true,
        description: l10n.t('The revision this tag points to.') },
      {
        id: 'name', type: 'text', label: l10n.t('Tag name'), placeholder: l10n.t('Enter tag name'), required: true,
        description: annotated ? l10n.t('Create an annotated tag, which stores a message.') : l10n.t('Create a lightweight tag, which is a name for this revision.'),
      },
      ...(annotated ? [
        {
          id: 'message', type: 'text' as const, label: l10n.t('Message'),
          description: l10n.t('The message stored with this annotated tag.'),
          placeholder: l10n.t('optional'), multiline: true,
        },
        { id: 'pushAllRemotes', type: 'checkbox' as const, label: l10n.t('Push to all remotes'),
          description: l10n.t('Push this tag to every remote.') },
      ] : []),
    ],
  };
}

export function branchRenameForm(
  oldName: string,
  upstream: BranchUpstream | null,
  whitespaceReplacement = '-',
): OperationFormDefinition {
  return {
    title: l10n.t('Rename Local Branch'),
    submitLabel: l10n.t('Rename'),
    values: { name: oldName, ...(upstream ? { renameRemote: false } : {}) },
    fields: [
      { id: 'name', type: 'text', label: l10n.t('New name'), required: true, replaceWhitespace: whitespaceReplacement,
        description: l10n.t('The new name of this local branch.') },
      ...(upstream
        ? [{
            id: 'renameRemote', type: 'checkbox' as const,
            label: l10n.t("Also rename '{0}/{1}'", upstream.remote, upstream.branch),
          }]
        : []),
    ],
  };
}

export function branchDeleteForm(
  name: string,
  upstream: BranchUpstream | null,
): OperationFormDefinition {
  return {
    title: l10n.t('Delete Branch'),
    submitLabel: l10n.t('Delete'),
    values: { name, ...(upstream ? { deleteRemote: false } : {}) },
    fields: [
      {
        id: 'name', type: 'text', label: l10n.t('Branch'), readOnly: true,
        description: l10n.t('Delete this local branch.'),
      },
      ...(upstream
        ? [{
            id: 'deleteRemote', type: 'checkbox' as const,
            label: l10n.t('Also delete remote branch ({0}/{1})', upstream.remote, upstream.branch),
          }]
        : []),
    ],
  };
}

export function remoteBranchDeleteForm(name: string): OperationFormDefinition {
  return {
    title: l10n.t('Delete Branch'),
    submitLabel: l10n.t('Delete'),
    values: { name },
    fields: [{
      id: 'name', type: 'text', label: l10n.t('Branch'), readOnly: true,
      description: l10n.t('Delete this branch from the remote.'),
    }],
  };
}

export function upstreamRefForm(
  snapshot: RefsSnapshotDto,
  branchName: string,
): OperationFormDefinition {
  const refs = snapshot.remoteBranches
    .filter((branch) => !branch.name.endsWith('/HEAD'))
    .map((branch) => branch.name);
  const current = snapshot.branches.find((branch) => branch.name === branchName)?.upstream;
  return {
    title: l10n.t('Set Upstream'),
    submitLabel: l10n.t('Set Upstream'),
    values: { upstream: current ?? '' },
    fields: [{
      id: 'upstream', type: 'text', label: l10n.t('Upstream branch'), required: true,
      description: l10n.t('The remote-tracking branch this branch tracks.'),
      suggestions: refs.map((value) => ({
        value,
        label: value === current ? l10n.t('{0} (current)', value) : value,
      })),
    }],
  };
}

export function validateUpstreamRefForm(
  values: OperationFormValues,
  snapshot: RefsSnapshotDto,
): OperationFormErrors {
  const refs = new Set(snapshot.remoteBranches
    .filter((branch) => !branch.name.endsWith('/HEAD'))
    .map((branch) => branch.name));
  const upstream = String(values.upstream ?? '').trim();
  return refs.has(upstream)
    ? {}
    : { upstream: l10n.t('Choose a remote-tracking branch.') };
}

export function validateBranchRenameForm(
  values: OperationFormValues,
  oldName: string,
): OperationFormErrors {
  const errors: OperationFormErrors = {};
  const name = String(values.name ?? '').trim();
  const problem = validateBranchName(name);
  if (problem) {
    errors.name = problem;
  } else if (name === oldName) {
    errors.name = l10n.t('Enter a different branch name');
  }
  return errors;
}

export function validateTagForm(values: OperationFormValues): OperationFormErrors {
  const errors: OperationFormErrors = {};
  const name = String(values.name).trim();
  if (!isSafeGitToken(name) || name.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'))) {
    errors.name = l10n.t('Enter a valid tag name without spaces or options.');
  }
  const target = validateStartPoint(String(values.objectRef));
  if (target) { errors.objectRef = target; }
  return errors;
}

export function stashCreateForm(
  canSelectFiles: boolean, currentBranch = '',
  messages: { value: string; label?: string }[] = [],
): OperationFormDefinition {
  return {
    title: l10n.t('Save Stash'),
    submitLabel: l10n.t('Save Stash'),
    values: { message: messages[0]?.value ?? '', includeUntracked: false, mode: 'all' },
    fields: [
      { id: 'message', type: 'text', label: l10n.t('Stash message'),
        description: l10n.t('A note stored with this stash entry.'),
        placeholder: currentBranch ? l10n.t('WIP on {0}', currentBranch) : l10n.t('WIP'),
        suggestions: messages },
      {
        id: 'includeUntracked', type: 'checkbox', label: l10n.t('Untracked files'),
        description: l10n.t('Include files that are not yet tracked.'),
      },
      { id: 'mode', type: 'radio', label: l10n.t('Files to stash'),
        description: l10n.t('Which changes go into the stash entry.'), options: [
        { value: 'all', label: l10n.t('All changes') },
        ...(canSelectFiles ? [{ value: 'paths', label: l10n.t('Select files') }] : []),
      ] },
    ],
  };
}

export function submoduleAddForm(): OperationFormDefinition {
  return {
    title: l10n.t('Add Submodule'),
    submitLabel: l10n.t('Add Submodule'),
    values: { url: '', path: '', recursive: false },
    fields: [
      {
        id: 'url', type: 'text', label: l10n.t('Repository URL'), required: true,
        description: l10n.t('The URL of the Git repository to add.'),
        placeholder: l10n.t('Git repository URL'),
      },
      {
        id: 'path', type: 'text', label: l10n.t('Submodule folder'), required: true,
        description: l10n.t('The folder inside this repository where the submodule is checked out.'),
        placeholder: l10n.t('Relative local path'),
      },
      { id: 'recursive', type: 'checkbox', label: l10n.t('Fetch submodules recursively'),
        description: l10n.t('Also fetch nested submodules.') },
    ],
  };
}

export function cloneForm(location: string): OperationFormDefinition {
  return {
    title: l10n.t('Clone'),
    submitLabel: l10n.t('Clone'),
    values: { url: '', location },
    fields: [
      {
        id: 'url', type: 'text', label: l10n.t('Repository URL'), required: true,
        description: l10n.t('The URL of the Git repository to clone.'),
        placeholder: l10n.t('Git repository URL'), pickLabel: l10n.t('Test connection'),
      },
      { id: 'location', type: 'text', label: l10n.t('Location'), required: true, pickLabel: l10n.t('Choose folder'),
        description: l10n.t('The folder where the clone is created.') },
    ],
  };
}

export function remoteAddForm(existing: readonly string[]): OperationFormDefinition {
  return {
    title: l10n.t('Add Remote'),
    submitLabel: l10n.t('Add Remote'),
    values: { name: existing.includes('origin') ? '' : 'origin', url: '' },
    fields: [
      { id: 'name', type: 'text', label: l10n.t('Remote'), required: true,
        description: l10n.t('A short name for this remote, such as origin.') },
      {
        id: 'url', type: 'text', label: l10n.t('Repository URL'), required: true,
        description: l10n.t('The URL Git uses to fetch from and push to this repository.'),
        placeholder: l10n.t('Git repository URL'), pickLabel: l10n.t('Test connection'),
      },
    ],
  };
}

export function submoduleFormRequest(values: OperationFormValues): SubmoduleAddRequest {
  return {
    url: String(values.url).trim(), path: String(values.path).trim(),
    branch: '', recursive: values.recursive === true,
  };
}

export function validateSubmoduleForm(values: OperationFormValues): OperationFormErrors {
  return validateSubmoduleAdd(submoduleFormRequest(values));
}

export function applyPatchForm(): OperationFormDefinition {
  return {
    title: l10n.t('Apply Patch'),
    submitLabel: l10n.t('Apply'),
    values: { location: '', createCommit: true },
    fields: [
      {
        id: 'location', type: 'text', label: l10n.t('Location'), required: true, pickLabel: l10n.t('Choose patch file'),
        placeholder: l10n.t('Path to a .patch or .diff file'),
        description: l10n.t('The patch file to apply to this repository.'),
      },
      {
        id: 'createCommit', type: 'checkbox', label: l10n.t('Create commit'),
        description: l10n.t('Keep the commit information of a patch made by Git; other patches only change the files.'),
      },
    ],
  };
}

export function createPatchForm(revision: string, format: 'format-patch' | 'diff' = 'format-patch'): OperationFormDefinition {
  return {
    title: l10n.t('Create Patch'),
    submitLabel: l10n.t('Save'),
    values: { revision, format },
    fields: [
      {
        id: 'revision', type: 'text', label: l10n.t('Revision'), required: true,
        placeholder: l10n.t('Commit, branch, tag or range'),
        description: l10n.t('A commit or ref, or a range such as main..topic for several commits.'),
      },
      {
        id: 'format', type: 'radio', label: l10n.t('Format'),
        options: [
          { value: 'format-patch', label: l10n.t('Patch with commit information (author, date and message)') },
          { value: 'diff', label: l10n.t('Plain diff') },
        ],
      },
    ],
  };
}

export function undoOperationForm(
  branch: string,
  operation: { label: string; message: string },
  previousSummary: string,
): OperationFormDefinition {
  return {
    title: l10n.t('Undo Last Operation'),
    submitLabel: l10n.t('Undo'),
    values: { operation: operation.message, target: previousSummary, mode: 'keep' },
    fields: [
      {
        id: 'operation', type: 'text', label: operation.label, readOnly: true,
        description: l10n.t("The last change to the '{0}' branch.", branch),
      },
      {
        id: 'target', type: 'text', label: l10n.t('Move back to'), readOnly: true,
        description: l10n.t("The '{0}' branch returns to this commit. Undo again to redo.", branch),
      },
      {
        id: 'mode', type: 'radio', label: l10n.t('Local changes'),
        options: [
          { value: 'keep', label: l10n.t('Keep: stop if they would be overwritten') },
          { value: 'hard', label: l10n.t('Discard: restore the files of that commit') },
        ],
      },
    ],
  };
}
