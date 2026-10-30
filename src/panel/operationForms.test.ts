import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  branchDeleteForm,
  branchRenameForm,
  mergeForm,
  MERGE_TYPE_DEFAULT,
  MERGE_TYPE_FAST_FORWARD,
  rebaseForm,
  remoteBranchDeleteForm,
  stashCreateForm,
  tagCreateForm,
  editCommitMessageForm,
  validateBranchRenameForm,
  validateTagForm,
  worktreeCreateForm,
  gitFlowInitForm,
  applyStashForm,
  deleteStashForm,
  renameStashForm,
  tagDetailsForm,
  upstreamRefForm,
  submoduleAddForm,
  remoteAddForm,
  cloneForm,
  resetForm,
  gitFlowInitFromValues,
  validateGitFlowInitForm,
  applyPatchForm,
  createPatchForm,
  undoOperationForm,
} from './operationForms';
import { validateOperationForm } from '../shared/forms/operationForm';

describe('operation-specific form definitions', () => {
  it('shows what the undo reverts and where the branch goes back to, keeping local changes by default', () => {
    const form = undoOperationForm('main', { label: 'Reset', message: 'reset: moving to HEAD~2' }, 'abc1234 add search');
    assert.equal(form.title, 'Undo Last Operation');
    assert.equal(form.submitLabel, 'Undo');
    assert.deepEqual(form.values, { operation: 'reset: moving to HEAD~2', target: 'abc1234 add search', mode: 'keep' });
    const operation = form.fields.find((field) => field.id === 'operation');
    assert.equal(operation?.label, 'Reset');
    assert.equal(operation?.type === 'text' && operation.readOnly, true);
    const mode = form.fields.find((field) => field.id === 'mode');
    assert.deepEqual(mode?.type === 'radio' && mode.options.map((option) => option.value), ['keep', 'hard']);
  });

  it('asks which revision to save as a patch and in what format', () => {
    const form = createPatchForm('abc1234');
    assert.equal(form.title, 'Create Patch');
    assert.equal(form.submitLabel, 'Save');
    assert.deepEqual(form.values, { revision: 'abc1234', format: 'format-patch' });
    const revision = form.fields.find((field) => field.id === 'revision');
    assert.equal(revision?.type === 'text' && revision.required, true);
    const format = form.fields.find((field) => field.id === 'format');
    assert.deepEqual(format?.type === 'radio' && format.options.map((option) => option.value), ['format-patch', 'diff']);
  });

  it('asks for a patch file and whether to create a commit, with Create commit on', () => {
    const form = applyPatchForm();
    assert.equal(form.title, 'Apply Patch');
    assert.equal(form.submitLabel, 'Apply');
    assert.deepEqual(form.values, { location: '', createCommit: true });
    const location = form.fields.find((field) => field.id === 'location');
    assert.equal(location?.type === 'text' && location.required, true);
    assert.ok(location?.type === 'text' && location.pickLabel);
    assert.equal(form.fields.find((field) => field.id === 'createCommit')?.type, 'checkbox');
  });

  it('offers merge options and warns inline when preflight finds conflicts', () => {
    const form = mergeForm('agent/feature', 'main', true);
    assert.equal(form.title, 'Merge');
    assert.equal(form.notice?.message, 'Merge will cause conflicts');
    assert.deepEqual(form.values, {
      source: 'agent/feature', target: 'main', mergeType: MERGE_TYPE_FAST_FORWARD,
    });
    const mergeType = form.fields.find((field) => field.id === 'mergeType');
    assert.equal(mergeType?.type, 'text');
    if (mergeType?.type === 'text') {
      assert.deepEqual(mergeType.suggestions?.map((entry) => entry.value), [
        MERGE_TYPE_DEFAULT, MERGE_TYPE_FAST_FORWARD,
      ]);
    }
    assert.equal(form.fields.find((field) => field.id === 'source')?.description, 'The branch to merge.');
    assert.equal(form.fields.find((field) => field.id === 'target')?.description, 'The branch that receives the merged commits.');
    assert.equal(mergeType?.description, 'How Git combines the two branches.');
    assert.deepEqual(validateOperationForm(form, form.values).errors, {});
    assert.equal(mergeForm('agent/feature', 'main', false).notice, undefined);
  });

  it('shows rebase targets, options, and preflight status', () => {
    const form = rebaseForm('main', 'agent/feature', false);
    assert.equal(form.title, 'Rebase');
    assert.deepEqual(form.notice, {
      kind: 'success', message: 'Rebase can complete without conflicts',
    });
    assert.deepEqual(form.values, {
      source: 'main', target: 'agent/feature',
      updateDependentBranches: false, stashAndReapply: false,
    });
    assert.equal(form.fields.find((field) => field.id === 'source')?.description, 'The branch to rebase.');
    assert.equal(form.fields.find((field) => field.id === 'target')?.description, 'The revision these commits are replayed onto.');
    assert.deepEqual(form.fields.map((field) => field.id), [
      'source', 'target', 'updateDependentBranches', 'stashAndReapply',
    ]);
    const options = form.fields.filter((field) => field.type === 'checkbox');
    assert.equal(options.length, 2);
    assert.equal(options[0]?.group, 'Options');
    assert.equal(options[1]?.group, 'Options');
    assert.equal(rebaseForm('main', 'agent/feature', true).notice?.kind, 'warning');
  });

  it('starts branch checkout in existing mode with a matching destination', () => {
    const form = worktreeCreateForm({
      repoRoot: '/repos/main', currentBranch: 'main', branchNames: ['main', 'topic'],
      existingBranch: 'topic', refs: [], worktrees: [],
      prefill: { currentBranch: 'agent/current', separator: '/' },
    });
    assert.equal(form.title, 'Checkout Branch as Worktree');
    assert.deepEqual(form.fields.map((field) => field.id), ['startPoint', 'path']);
    assert.ok(form.fields.some((field) => field.id === 'startPoint' && field.type === 'text' && field.readOnly));
    assert.equal(form.values.startPoint, 'topic');
    assert.equal(form.values.path, '/repos/main-topic');
  });

  it('preserves the worktree branch prefix and exposes native ref and folder selection', () => {
    const form = worktreeCreateForm({
      repoRoot: '/repos/main', currentBranch: 'agent/current', branchNames: ['agent/current'],
      refs: [], worktrees: [], prefill: { currentBranch: 'agent/current', separator: '/' },
    });
    assert.equal(form.title, 'Create Worktree');
    assert.deepEqual(form.fields.map((field) => field.id), ['startPoint', 'newBranch', 'path']);
    assert.equal(form.values.newBranch, 'agent/');
    assert.equal(form.values.startPoint, 'agent/current');
    assert.ok(form.fields.some((field) => field.id === 'path' && field.type === 'text' && field.pickLabel));
    assert.ok(form.fields.some((field) => field.id === 'startPoint' && field.type === 'text' && field.suggestions?.length));
  });

  for (const name of ['', '--delete', 'bad name', '.hidden', 'dir/.hidden', 'dir.lock/tag', 'tag..bad', 'dir//tag']) {
    it(`rejects invalid tag name ${JSON.stringify(name)}`, () => {
      assert.ok(validateTagForm({ name, objectRef: 'HEAD' }).name);
    });
  }

  it('allows valid tag names, validates targets, and leaves annotated messages optional', () => {
    assert.deepEqual(validateTagForm({ name: 'release/v1.0', objectRef: 'HEAD~1' }), {});
    assert.ok(validateTagForm({ name: 'v1', objectRef: '--delete' }).objectRef);
    const form = tagCreateForm('main', true);
    const result = validateOperationForm(form, { ...form.values, name: 'v1' });
    assert.equal(result.errors.message, undefined);
    assert.equal(result.values.pushAllRemotes, false);
    assert.equal(form.title, 'Create Tag');
    assert.equal(form.fields.find((field) => field.id === 'objectRef')?.description, 'The revision this tag points to.');
    assert.equal(form.fields.find((field) => field.id === 'name')?.description, 'Create an annotated tag, which stores a message.');
    assert.equal(form.fields.find((field) => field.id === 'message')?.description, 'The message stored with this annotated tag.');
    assert.equal(form.fields.find((field) => field.id === 'pushAllRemotes')?.description, 'Push this tag to every remote.');
    assert.deepEqual(form.fields.map((field) => field.id), [
      'objectRef', 'name', 'message', 'pushAllRemotes',
    ]);
    const messageField = form.fields.find((field) => field.id === 'message');
    assert.equal(messageField?.type === 'text' && messageField.multiline, true);
  });

  it('offers remote rename only when the branch has an upstream', () => {
    const upstream = { remote: 'origin', branch: 'main' };
    const form = branchRenameForm('main', upstream);
    assert.ok(form.fields.some((field) => field.id === 'renameRemote'));
    assert.equal(form.values.renameRemote, false);
    assert.deepEqual(validateBranchRenameForm({ name: 'main' }, 'main'), {
      name: 'Enter a different branch name',
    });
    assert.deepEqual(validateBranchRenameForm({ name: 'next' }, 'main'), {});
    assert.equal(form.fields.find((field) => field.id === 'name')?.description, 'The new name of this local branch.');
    assert.ok(!branchRenameForm('main', null).fields.some((field) => field.id === 'renameRemote'));
  });

  it('offers remote deletion only when the branch has an upstream', () => {
    const upstream = { remote: 'origin', branch: 'agent/feature' };
    const form = branchDeleteForm('agent/feature', upstream);
    assert.equal(form.title, 'Delete Branch');
    assert.equal(form.fields.find((field) => field.id === 'name')?.description, 'Delete this local branch.');
    assert.equal(form.submitLabel, 'Delete');
    assert.equal(form.values.deleteRemote, false);
    assert.ok(form.fields.some((field) => field.id === 'deleteRemote'));
    assert.ok(!branchDeleteForm('agent/feature', null).fields.some((field) => field.id === 'deleteRemote'));
    assert.equal(remoteBranchDeleteForm('origin/agent/feature').values.name, 'origin/agent/feature');
  });

  it('explains the remaining stash, reset, clone, tag, submodule, and worktree fields', () => {
    const stash = { index: 0, selector: 'stash@{0}', sha: 'abc1234', message: 'wip' };
    assert.equal(applyStashForm(stash).fields.find((field) => field.id === 'stash')?.description, 'The stash entry to apply.');
    assert.equal(deleteStashForm(stash).fields[0]?.description, 'The stash entry to drop.');
    assert.equal(resetForm('main', 'abc').fields.find((field) => field.id === 'branch')?.description, 'The branch whose head moves.');
    assert.equal(tagDetailsForm('v1', 'note').fields.find((field) => field.id === 'tag')?.description, 'The tag these details describe.');
    const saved = stashCreateForm(true, 'main');
    assert.equal(saved.fields.find((field) => field.id === 'message')?.description, 'A note stored with this stash entry.');
    assert.equal(saved.fields.find((field) => field.id === 'mode')?.description, 'Which changes go into the stash entry.');
    const submodule = submoduleAddForm();
    assert.equal(submodule.fields.find((field) => field.id === 'url')?.description, 'The URL of the Git repository to add.');
    assert.equal(submodule.fields.find((field) => field.id === 'path')?.description, 'The folder inside this repository where the submodule is checked out.');
    assert.equal(submodule.fields.find((field) => field.id === 'recursive')?.description, 'Also fetch nested submodules.');
    const clone = cloneForm('/repos/demo');
    assert.equal(clone.fields.find((field) => field.id === 'url')?.description, 'The URL of the Git repository to clone.');
    assert.equal(clone.fields.find((field) => field.id === 'location')?.description, 'The folder where the clone is created.');
    const worktree = worktreeCreateForm({
      repoRoot: '/repos/main', currentBranch: 'main', branchNames: ['main'], refs: [], worktrees: [],
    });
    assert.equal(worktree.fields.find((field) => field.id === 'startPoint')?.description, 'The revision the new worktree starts from.');
    assert.equal(worktree.fields.find((field) => field.id === 'newBranch')?.description, 'The name of the new branch.');
    assert.equal(worktree.fields.find((field) => field.id === 'path')?.description, 'The folder for this worktree.');
    const existing = worktreeCreateForm({
      repoRoot: '/repos/main', currentBranch: 'main', branchNames: ['main'], existingBranch: 'main',
      refs: [], worktrees: [],
    });
    assert.equal(existing.fields.find((field) => field.id === 'startPoint')?.description, 'The local branch to check out in this worktree.');
  });

  it('does not offer selected-file stashing when there are no changed files', () => {
    const form = stashCreateForm(false);
    assert.ok(validateOperationForm(form, { ...form.values, mode: 'paths' }).errors.mode);
    assert.equal(form.values.includeUntracked, false);
  });

  it('suggests HEAD, branches, and refs when creating a worktree on a new branch', () => {
    const form = worktreeCreateForm({
      repoRoot: '/repos/main', currentBranch: 'main', branchNames: ['main', 'topic'],
      refs: ['origin/main'], worktrees: [{ path: '/repos/main', branch: 'refs/heads/main' }],
    });
    const field = form.fields.find((entry) => entry.id === 'startPoint');
    if (field?.type !== 'text') { throw new Error('Missing start point'); }
    assert.deepEqual(field.suggestions?.map((entry) => entry.value), ['HEAD', 'main', 'topic', 'origin/main']);
  });

  describe('git-flow init form', () => {
    const defaults = {
      production: 'main', develop: 'develop', featurePrefix: 'feature/', releasePrefix: 'release/',
      hotfixPrefix: 'hotfix/', versionTagPrefix: '',
    };

    it('asks for the branches and prefixes git-flow needs', () => {
      const form = gitFlowInitForm(defaults, ['main', 'topic']);
      assert.equal(form.title, 'Initialize Git Flow');
      assert.equal(form.submitLabel, 'Initialize');
      assert.deepEqual(form.fields.map((field) => field.label), [
        'Production branch', 'Development branch', 'Feature prefix', 'Release prefix', 'Hotfix prefix',
        'Version tag prefix',
      ]);
      assert.deepEqual(form.values, defaults);
      const production = form.fields[0];
      assert.ok(production.type === 'text' && production.required);
      assert.deepEqual(production.type === 'text' && production.suggestions?.map((entry) => entry.value), ['main', 'topic']);
      assert.deepEqual(form.fields.map((field) => field.description), [
        'The branch that holds released work.',
        'The branch that holds ongoing work.',
        'The start of a new feature branch name.',
        'The start of a release branch name.',
        'The start of a hotfix branch name.',
        'The start of a version tag. Leave it empty for none.',
      ]);
    });

    it('round-trips the values and reports field errors', () => {
      assert.deepEqual(gitFlowInitFromValues({ ...defaults }), defaults);
      assert.deepEqual(validateGitFlowInitForm({ ...defaults }, ['main']), {});
      const errors = validateGitFlowInitForm({ ...defaults, production: 'trunk', featurePrefix: '' }, ['main']);
      assert.deepEqual(Object.keys(errors).sort(), ['featurePrefix', 'production']);
    });
  });
});

describe('edit commit message form', () => {
  it('shows the commit and the whole message, and needs a message', () => {
    const form = editCommitMessageForm('abcdef1234', 'subject', 'subject\n\nbody', []);
    assert.equal(form.title, 'Edit Commit Message');
    assert.equal(form.submitLabel, 'Edit Message');
    assert.deepEqual(form.values, { commit: 'abcdef1 subject', message: 'subject\n\nbody' });
    assert.deepEqual(form.fields.map((field) => field.id), ['commit', 'message']);
    const message = form.fields.find((field) => field.id === 'message');
    assert.equal(message?.type === 'text' && message.multiline, true);
    assert.equal(message?.type === 'text' && message.required, true);
    assert.equal(form.notice, undefined);
  });

  it('warns when a remote branch already has the commit', () => {
    const form = editCommitMessageForm('abcdef1234', 's', 's', ['origin/main']);
    assert.equal(form.notice?.kind, 'warning');
    assert.match(form.notice?.message ?? '', /'origin\/main' already has this commit.*force push/);
  });
});

describe('operation form wording', () => {
  const stash = { index: 0, selector: 'stash@{0}', sha: 'abc', message: 'wip' };
  const forms = [
    gitFlowInitForm({
      production: 'main', develop: 'develop', featurePrefix: 'feature/', releasePrefix: 'release/',
      hotfixPrefix: 'hotfix/', versionTagPrefix: '',
    }, ['main']),
    applyStashForm(stash), renameStashForm(stash), deleteStashForm(stash),
    mergeForm('a', 'b', false), rebaseForm('a', 'b', false), tagDetailsForm('v1', 'm'),
    tagCreateForm('HEAD', true), branchRenameForm('a', { remote: 'origin', branch: 'a' }),
    branchDeleteForm('a', null), remoteBranchDeleteForm('origin/a'),
    upstreamRefForm({ remoteBranches: [], branches: [] } as never, 'a'),
    stashCreateForm(true), submoduleAddForm(), remoteAddForm([]), editCommitMessageForm('abcdef1234', 'subject', 'subject\n\nbody', []),
  ];

  it('gives every form a submit label that names its action', () => {
    for (const form of forms) {
      assert.notEqual(form.submitLabel, 'Submit', form.title);
    }
  });

  it('writes field labels, placeholders and picker buttons in sentence case', () => {
    const texts = forms.flatMap((form) => form.fields.flatMap((field) => [
      field.label,
      ...(field.type === 'text' ? [field.placeholder, field.pickLabel] : []),
    ]));
    for (const text of texts) {
      if (!text) { continue; }
      const later = text.split(' ').slice(1).filter((word) => /^[A-Z][a-z]/.test(word));
      assert.deepEqual(later, [], text);
    }
  });
});
