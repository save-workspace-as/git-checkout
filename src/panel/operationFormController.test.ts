import { strict as assert } from 'node:assert';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import * as l10n from '@vscode/l10n';
import type { Uri } from 'vscode';
import type { GitCli } from '../core/gitCli';
import { mockGitCli } from '../core/testing/serviceTestUtils';
import type { OperationFormDefinition, OperationFormHostMessage, OperationFormModalHostMessage, OperationFormValues, OperationFormWebviewMessage } from '../shared/forms/operationForm';
import type { BranchCreatePromptContext } from '../features/branches/branchCreateHost';
import type { OperationFormController, OperationFormHandler, ShowOperationForm } from './operationFormController';

const code = buildSync({
  entryPoints: [join(__dirname, '../features/branches/branchCreateHost.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['vscode', 'node:crypto', '@vscode/l10n'],
}).outputFiles[0].text;

interface BranchFormExports {
  branchCreateForm(context: BranchCreatePromptContext): OperationFormDefinition;
  createBranchInForm(show: ShowOperationForm, cli: GitCli, context: BranchCreatePromptContext): Promise<boolean>;
}
const genericCode = buildSync({
  entryPoints: [join(__dirname, 'operationFormController.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['vscode', 'node:crypto', '@vscode/l10n'],
}).outputFiles[0].text;

const operationCode = ['operationForms', '../features/worktrees/worktreeHost', '../features/stash/stashHost', '../features/branches/refsMutationsHost', '../features/sync/fetchHost', '../features/sync/pullHost', '../features/sync/pushHost'].map((name) =>
  buildSync({
    entryPoints: [join(__dirname, `${name}.ts`)],
    bundle: true, platform: 'node', format: 'cjs', write: false,
    external: ['vscode', 'node:crypto', '@vscode/l10n'],
  }).outputFiles[0].text,
);

function harness() {
  const messages: OperationFormHostMessage[] = [];
  const notifications: string[] = [];
  const confirmations: string[] = [];
  const logged: unknown[][] = [];
  let confirmation: string | undefined;
  let picked: string | { label: string } | { label: string }[] | undefined;
  const pickerItems: unknown[] = [];
  let folders: { fsPath: string }[] | undefined;
  const envelopes: OperationFormModalHostMessage[] = [];
  let sessionId = 0;
  let revealed = 0;
  let disposed = false;
  const uri = (path: string): Uri => ({
    toString: () => path,
  }) as Uri;
  const vscode = {
    Uri: {
      joinPath: (base: Uri, ...parts: string[]) => uri([base.toString(), ...parts].join('/')),
      file: (value: string) => uri(value),
    },
    ViewColumn: { Active: -1 },
    workspace: { getConfiguration: () => ({ get: (_key: string, fallback?: unknown) => fallback }) },
    ThemeIcon: class {},
    window: {
      createWebviewPanel: () => { throw new Error('Operation forms must not create an editor tab'); },
      showWarningMessage: async (message: string) => { confirmations.push(message); return confirmation; },
      showErrorMessage: async (message: string) => { notifications.push(message); },
      showInformationMessage: async (message: string) => { notifications.push(message); },
      showQuickPick: async (items: unknown) => { pickerItems.push(items); return picked; },
      showOpenDialog: async () => folders,
      createOutputChannel: () => ({
        trace() {}, debug() {}, info() {}, warn() {},
        error: (...args: unknown[]) => logged.push(args),
      }),
    },
  };
  const environment = {
    process,
    require: (name: string) => {
      if (name === 'vscode') { return vscode; }
      if (name === 'node:crypto') { return crypto; }
      if (name === '@vscode/l10n') { return l10n; }
      if (name === 'node:fs') { return fs; }
      if (name === 'node:path' || name === 'path') { return path; }
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  const branchModule = { exports: {} as BranchFormExports };
  runInNewContext(code, { ...environment, module: branchModule });
  const genericModule = { exports: {} as {
    OperationFormController: typeof OperationFormController;
  } };
  runInNewContext(genericCode, { ...environment, module: genericModule });
  const controller = new genericModule.exports.OperationFormController(
    () => { revealed++; },
    (message) => {
      envelopes.push(message);
      if (message.type === 'operationFormOpen') {
        sessionId = message.sessionId;
        disposed = false;
      } else if (message.type === 'operationFormUpdate') {
        messages.push(message.message);
      } else {
        disposed = true;
      }
    },
  );
  function load<T>(index: number): T {
    const module = { exports: {} as T };
    runInNewContext(operationCode[index], { ...environment, module });
    return module.exports;
  }
  const context: BranchCreatePromptContext = {
    currentBranch: 'agent/feature', startRef: 'main', separator: '/',
  };
  const form = branchModule.exports.branchCreateForm(context);
  return {
    messages, notifications, confirmations, logged, form, envelopes, controller, pickerItems,
    panel: { dispose: () => { disposed = true; controller.dispose(); } },
    get revealed() { return revealed; },
    get sessionId() { return sessionId; },
    get disposed() { return disposed; },
    setConfirmation: (value: string | undefined) => { confirmation = value; },
    setPicked: (value: typeof picked) => { picked = value; },
    setFolders: (value: typeof folders) => { folders = value; },
    models: load<typeof import('./operationForms')>(0),
    worktree: load<typeof import('../features/worktrees/worktreeHost')>(1),
    stash: load<typeof import('../features/stash/stashHost')>(2),
    refs: load<typeof import('../features/branches/refsMutationsHost')>(3),
    fetch: load<typeof import('../features/sync/fetchHost')>(4),
    pull: load<typeof import('../features/sync/pullHost')>(5),
    push: load<typeof import('../features/sync/pushHost')>(6),
    show: controller.show,
    receive: async (message: OperationFormWebviewMessage) => {
      await new Promise((resolve) => setImmediate(resolve));
      await controller.handleWebviewMessage({ type: 'operationFormMessage', sessionId, message });
    },
    branch: (cli: GitCli) => branchModule.exports.createBranchInForm(controller.show, cli, context),
    generic: (handler: OperationFormHandler, definition = form) =>
      controller.show(definition, handler),
  };
}

describe('shared operation form modal controller', () => {
  it('collects fetch choices in one modal and cancels without a result', async () => {
    const h = harness();
    const catalog = { remotes: ['origin', 'upstream'], upstreamRemote: 'origin' };
    const pending = h.fetch.promptFetchChoices(catalog, { remote: 'origin', all: false }, h.show);
    const remote = h.controller.current()?.form.fields.find((field) => field.id === 'remote');
    assert.equal(remote?.description, 'Download objects and refs from this remote.');
    await h.receive({ type: 'formSubmit', values: { remote: 'upstream', all: true } });
    assert.deepEqual(JSON.parse(JSON.stringify(await pending)), { remote: 'upstream', all: true });
    const cancelled = h.fetch.promptFetchChoices(catalog, { remote: 'origin', all: false }, h.show);
    await h.receive({ type: 'formCancel' });
    assert.equal(await cancelled, undefined);
    assert.equal(h.pickerItems.length, 0);
  });

  it('restricts pull branches to the selected remote and preserves pull options', async () => {
    const h = harness();
    const pending = h.pull.promptPullChoices({
      remotes: ['origin', 'upstream'], localBranches: ['main', 'other'], branchesByRemote: { origin: ['main'], upstream: ['topic'] },
      headName: 'main', upstreamRemote: 'origin', upstreamBranch: 'main', rebaseByDefault: false,
    }, { remote: 'origin', branch: 'main', rebase: false, stash: false }, h.show);
    await h.receive({ type: 'formSubmit', values: {
      remote: 'upstream', branch: 'main', into: 'main', rebase: true, stash: true,
    } });
    assert.ok(h.controller.current());
    await h.receive({ type: 'formSubmit', values: {
      remote: 'upstream', branch: 'topic', into: 'main', rebase: true, stash: true,
    } });
    assert.deepEqual(JSON.parse(JSON.stringify(await pending)), {
      remote: 'upstream', branch: 'topic', rebase: true, stash: true, into: 'main',
    });
  });

  it('offers the checked-out branch first and then the other local branches to pull into', async () => {
    const h = harness();
    const pending = h.pull.promptPullChoices({
      remotes: ['origin'], localBranches: ['alpha', 'main', 'zeta'], branchesByRemote: { origin: ['main'] },
      headName: 'main', upstreamRemote: 'origin', upstreamBranch: 'main', rebaseByDefault: false,
    }, { remote: 'origin', branch: 'main', rebase: false, stash: false }, h.show);
    const form = h.controller.current()?.form;
    const branch = form?.fields.find((field) => field.id === 'branch');
    const into = form?.fields.find((field) => field.id === 'into');
    assert.equal(branch?.description, 'The branch to pull from this remote.');
    assert.ok(into && into.type === 'text');
    assert.equal(into.description, 'The local branch that receives the pulled commits.');
    const options = form?.fields.filter((field) => field.type === 'checkbox') ?? [];
    assert.equal(options.length, 2);
    assert.equal(options[0]?.group, 'Options');
    assert.equal(options[1]?.group, 'Options');
    assert.deepEqual(JSON.parse(JSON.stringify(into.suggestions?.map((suggestion) => suggestion.value))), ['main', 'alpha', 'zeta']);
    assert.equal(into.readOnly, undefined);
    assert.equal(h.controller.current()?.form.values.into, 'main');
    await h.receive({ type: 'formSubmit', values: {
      remote: 'origin', branch: 'main', into: 'alpha', rebase: false, stash: false,
    } });
    assert.equal((await pending)?.into, 'alpha');
  });

  it('requires native force-push confirmation and only offers existing local branches', async () => {
    const h = harness();
    const pending = h.push.promptPushChoices({
      remotes: ['origin'], localBranches: ['main'], headName: 'main',
      upstreamRemote: 'origin', upstreamBranch: 'main',
    }, { remote: 'origin', branch: 'main', tags: false, force: false }, h.show);
    const form = h.controller.current()?.form;
    const branch = form?.fields.find((field) => field.id === 'branch');
    assert.equal(branch?.description, 'The local branch to push to this remote.');
    const options = form?.fields.filter((field) => field.type === 'checkbox') ?? [];
    assert.equal(options.length, 2);
    assert.equal(options[0]?.group, 'Options');
    assert.equal(options[1]?.group, 'Options');
    const values = { remote: 'origin', branch: 'main', tags: true, force: true };
    await h.receive({ type: 'formSubmit', values: { ...values, branch: 'custom' } });
    assert.equal(h.confirmations.length, 0);
    await h.receive({ type: 'formSubmit', values });
    assert.ok(h.controller.current());
    h.setConfirmation('Push');
    await h.receive({ type: 'formSubmit', values });
    assert.deepEqual(JSON.parse(JSON.stringify(await pending)), values);
  });

  it('warns instead of opening a sync modal when no remotes exist', async () => {
    const h = harness();
    assert.equal(await h.fetch.promptFetchChoices(
      { remotes: [], upstreamRemote: null }, { remote: '', all: false }, h.show,
    ), undefined);
    assert.equal(h.controller.current(), undefined);
    assert.ok(h.confirmations.includes('No remotes to fetch from.'));
  });

  it('opens Add Remote with a default name and validates before adding', async () => {
    const h = harness();
    const cli = mockGitCli();
    const pending = h.refs.runRefsMutation(cli.cli, { op: 'remoteAdd' }, 'main', 'main', h.show);
    await h.receive({ type: 'formReady' });
    assert.equal(h.controller.current()?.form.title, 'Add Remote');
    const fields = h.controller.current()?.form.fields;
    assert.equal(fields?.find((field) => field.id === 'name')?.description, 'A short name for this remote, such as origin.');
    assert.equal(fields?.find((field) => field.id === 'url')?.description, 'The URL Git uses to fetch from and push to this repository.');
    assert.equal(h.controller.current()?.form.values.name, 'origin');
    await h.receive({ type: 'formSubmit', values: { name: 'origin', url: '--invalid' } });
    assert.equal(cli.writes.length, 0);
    assert.ok(h.controller.current());
    await h.receive({ type: 'formSubmit', values: { name: ' origin ', url: ' /repos/upstream ' } });
    assert.equal(await pending, true);
    assert.deepEqual(cli.writes.map((args) => Array.from(args)), [['remote', 'add', '--', 'origin', '/repos/upstream']]);
    assert.equal(h.confirmations.length, 0);
  });

  it('does not prefill an existing origin and rejects duplicate remote names', async () => {
    const h = harness();
    const cli = mockGitCli({ execRead: async () => ({ stdout: 'origin\n' }) });
    const pending = h.refs.runRefsMutation(cli.cli, { op: 'remoteAdd' }, 'main', 'main', h.show);
    await h.receive({ type: 'formReady' });
    assert.equal(h.controller.current()?.form.values.name, '');
    await h.receive({ type: 'formSubmit', values: { name: 'origin', url: '/repos/upstream' } });
    assert.equal(cli.writes.length, 0);
    assert.ok(h.messages.some((message) => message.type === 'formStatus' && message.errors?.name));
    await h.receive({ type: 'formCancel' });
    assert.equal(await pending, false);
  });

  it('tests a URL without a complete remote name or any writes and retains the draft', async () => {
    const h = harness();
    const cli = mockGitCli();
    const pending = h.refs.runRefsMutation(cli.cli, { op: 'remoteAdd' }, 'main', 'main', h.show);
    await h.receive({ type: 'formReady' });
    await h.receive({ type: 'formPick', field: 'url', version: 1, values: { name: '', url: '' } });
    assert.equal(cli.reads.length, 1);
    assert.ok(h.messages.some((message) => message.type === 'formStatus' && message.error?.endsWith('URL is required')));
    await h.receive({ type: 'formPick', field: 'url', version: 2, values: { name: '', url: '/repos/upstream' } });
    assert.deepEqual(Array.from(cli.reads.at(-1) ?? []), ['ls-remote', '--', '/repos/upstream']);
    assert.equal(h.notifications.at(-1), 'The remote URL is reachable');
    assert.equal(cli.writes.length, 0);
    assert.ok(h.controller.current());
    assert.equal(h.messages.some((message) => message.type === 'formPicked'), false);
    await h.receive({ type: 'formCancel' });
    assert.equal(await pending, false);
  });

  it('shows a failed connection test inline and allows a successful retry', async () => {
    const h = harness();
    let failed = true;
    const cli = mockGitCli({ execRead: async (args) => {
      if (args[0] === 'ls-remote' && failed) { throw new Error('Connection failed'); }
      return { stdout: '' };
    } });
    const pending = h.refs.runRefsMutation(cli.cli, { op: 'remoteAdd' }, 'main', 'main', h.show);
    await h.receive({ type: 'formReady' });
    const values = { name: 'origin', url: '/repos/upstream' };
    await h.receive({ type: 'formPick', field: 'url', version: 1, values });
    assert.ok(h.messages.some((message) =>
      message.type === 'formStatus' && message.error?.endsWith('Could not reach the remote URL')));
    assert.equal(cli.writes.length, 0);
    failed = false;
    await h.receive({ type: 'formPick', field: 'url', version: 1, values });
    assert.equal(h.notifications.at(-1), 'The remote URL is reachable');
    await h.receive({ type: 'formSubmit', values });
    assert.equal(await pending, true);
    assert.equal(cli.writes.length, 1);
  });

  it('offers repository refs for branch start points without changing Git state', async () => {
    const h = harness();
    const cli = mockGitCli({ execRead: async () => ({
      stdout: 'refs/heads/main\nrefs/remotes/origin/main\nrefs/remotes/origin/HEAD\nrefs/tags/v1\n',
    }) });
    const pending = h.branch(cli.cli);
    await h.receive({ type: 'formReady' });
    const field = h.controller.current()?.form.fields.find((entry) => entry.id === 'startPoint');
    assert.equal(field?.type, 'text');
    if (field?.type !== 'text') { throw new Error('Missing ref dropdown'); }
    assert.deepEqual(Array.from(field.suggestions ?? [], (entry) => entry.value), [
      'main', 'HEAD', 'refs/heads/main', 'refs/remotes/origin/main', 'refs/tags/v1',
    ]);
    assert.equal(field.pickLabel, undefined);
    assert.equal(h.pickerItems.length, 0);
    assert.equal(cli.writes.length, 0);
    await h.receive({ type: 'formCancel' });
    assert.equal(await pending, false);
  });

  it('reuses existing stash messages without modifying or applying the existing stash', async () => {
    const h = harness();
    const requests: unknown[] = [];
    let loads = 0;
    const pending = h.stash.createStashInForm(h.show, ['a.txt'], async (request) => { requests.push(request); }, {
      currentBranch: 'topic',
      load: async () => {
        loads++;
        return [{ index: 0, selector: 'stash@{0}', sha: 'a'.repeat(40), message: 'On topic: in progress' }];
      },
    });
    assert.equal(loads, 1);
    const values = { message: '', mode: 'all', includeUntracked: false };
    await h.receive({ type: 'formReady' });
    const field = h.controller.current()?.form.fields.find((entry) => entry.id === 'message');
    if (field?.type !== 'text') { throw new Error('Missing stash dropdown'); }
    assert.equal(field.suggestions?.[0].value, 'On topic: in progress');
    assert.equal(field.suggestions?.[0].label, 'stash@{0}');
    assert.equal(field.pickLabel, undefined);
    assert.equal(requests.length, 0);
    await h.receive({ type: 'formSubmit', values: { ...values, message: 'My edited message' } });
    assert.equal(requests.length, 0);
    assert.equal(h.disposed, false);
    await h.receive({ type: 'formSubmit', values: { ...values, message: 'On topic: in progress' } });
    assert.equal(await pending, true);
    assert.equal((requests[0] as { message: string }).message, 'On topic: in progress');
  });

  it('retains the stash draft when there are no existing messages', async () => {
    const h = harness();
    const pending = h.stash.createStashInForm(h.show, [], async () => {}, {
      currentBranch: 'main', load: async () => [],
    });
    await h.receive({ type: 'formReady' });
    const field = h.controller.current()?.form.fields.find((entry) => entry.id === 'message');
    if (field?.type !== 'text') { throw new Error('Missing stash dropdown'); }
    assert.equal(field.suggestions?.length, 0);
    assert.equal(h.notifications.length, 0);
    assert.equal(h.messages.some((message) => message.type === 'formPicked'), false);
    await h.receive({ type: 'formCancel' });
    assert.equal(await pending, false);
  });

  it('surfaces failures loading stash dropdown choices instead of silently showing an empty list', async () => {
    const h = harness();
    const result = await h.stash.createStashInForm(h.show, [], async () => {}, {
      currentBranch: 'main', load: async () => { throw new Error('Git failed'); },
    });
    assert.equal(result, false);
    assert.equal(h.controller.current(), undefined);
    assert.equal(h.logged.length, 1);
    assert.equal(h.notifications[0], 'Could not load existing stash messages.');
  });

  it('keeps one form active and ignores messages from a previously closed form', async () => {
    const h = harness();
    const handler: OperationFormHandler = { validate: () => ({}), submit: async () => true };
    const first = h.generic(handler);
    const firstId = h.sessionId;
    assert.equal(await h.generic(handler), false);
    assert.equal(h.confirmations.length, 1);
    await h.receive({ type: 'formCancel' });
    assert.equal(await first, false);
    const second = h.generic(handler);
    assert.notEqual(h.sessionId, firstId);
    await h.controller.handleWebviewMessage({
      type: 'operationFormMessage', sessionId: firstId, message: { type: 'formCancel' },
    });
    assert.equal(h.controller.current()?.sessionId, h.sessionId);
    await h.receive({ type: 'formCancel' });
    assert.equal(await second, false);
  });

  it('does not dismiss a modal while a Git operation is running', async () => {
    const h = harness();
    let finish: (success: boolean) => void = () => {};
    const pending = h.generic({
      validate: () => ({}),
      submit: () => new Promise((resolve) => { finish = resolve; }),
    });
    const running = h.receive({ type: 'formSubmit', values: h.form.values });
    await h.receive({ type: 'formCancel' });
    assert.ok(h.controller.current());
    finish(true);
    await running;
    assert.equal(await pending, true);
    assert.equal(h.controller.current(), undefined);
  });

  it('uses native pickers without requiring the incomplete draft to be valid', async () => {
    const h = harness();
    const form = { ...h.form, fields: h.form.fields.map((field) =>
      field.id === 'name' ? { ...field, type: 'text' as const, pickLabel: 'Choose' } : field) };
    let picks = 0;
    const pending = h.generic({
      validate: () => ({}), submit: async () => true,
      pick: async () => { picks++; return 'topic'; },
    }, form);
    await h.receive({ type: 'formPick', field: 'checkout', version: 2, values: form.values });
    assert.equal(picks, 0);
    await h.receive({ type: 'formPick', field: 'name', version: 3, values: { ...form.values, name: '' } });
    assert.equal(picks, 1);
    assert.ok(h.messages.some((message) => message.type === 'formPicked'
      && message.field === 'name' && message.value === 'topic' && message.version === 3));
    h.panel.dispose();
    assert.equal(await pending, false);
  });

  it('creates worktrees with normalized requests and validates existing checked-out branches', async () => {
    const h = harness();
    const parent = fs.mkdtempSync(join(tmpdir(), 'operation-form-'));
    try {
      const context = {
        repoRoot: parent, currentBranch: 'main', branchNames: ['main', 'topic'], refs: ['origin/main'],
        worktrees: [{ path: parent, branch: 'refs/heads/main' }], existingBranch: 'main',
      };
      const created: unknown[] = [];
      const form = h.models.worktreeCreateForm(context);
      const pending = h.worktree.createWorktreeInForm(h.show, context, async (request) => { created.push(request); });
      const values = { ...form.values, path: join(parent, 'next'), startPoint: 'main' };
      await h.receive({ type: 'formSubmit', values });
      assert.equal(created.length, 0);
      assert.ok(h.messages.some((message) => message.type === 'formStatus' && message.errors?.startPoint));
      await h.receive({ type: 'formSubmit', values: { ...values, startPoint: 'topic' } });
      assert.equal(await pending, true);
      assert.deepEqual(JSON.parse(JSON.stringify(created)), [{ path: join(parent, 'next'), startPoint: 'topic' }]);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it('nests a suggested destination in a nonempty selected folder', async () => {
    const h = harness();
    const parent = fs.mkdtempSync(join(tmpdir(), 'operation-form-'));
    try {
      fs.writeFileSync(join(parent, 'existing.txt'), 'existing');
      const context = { repoRoot: join(parent, 'repo'), currentBranch: 'main', branchNames: ['main'],
        refs: ['origin/main'], worktrees: [] };
      const pending = h.worktree.createWorktreeInForm(h.show, context, async () => {});
      const values = { ...h.models.worktreeCreateForm(context).values, newBranch: 'agent/next' };
      h.setFolders([{ fsPath: parent }]);
      await h.receive({ type: 'formPick', field: 'path', version: 1, values });
      assert.ok(h.messages.some((message) => message.type === 'formPicked' && message.value === join(parent, 'agent-next')));
      h.panel.dispose();
      assert.equal(await pending, false);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  it('finishes cancellation if the form closes while a native picker is open', async () => {
    const h = harness();
    let finish: (value: string | undefined) => void = () => {};
    const pending = h.generic({
      validate: () => ({}), submit: async () => true,
      pick: () => new Promise((resolve) => { finish = resolve; }),
    }, { ...h.form, fields: [{ id: 'name', type: 'text', label: 'Name', pickLabel: 'Choose' }], values: { name: '' } });
    const picking = h.receive({ type: 'formPick', field: 'name', version: 1, values: { name: '' } });
    await new Promise((resolve) => setImmediate(resolve));
    h.panel.dispose();
    finish(undefined);
    await picking;
    assert.equal(await pending, false);
  });

  it('keeps a failed worktree form open and retries a new branch through the same callback', async () => {
    const h = harness();
    const parent = fs.mkdtempSync(join(tmpdir(), 'operation-form-'));
    try {
      const context = { repoRoot: parent, currentBranch: 'main', branchNames: ['main'], refs: [], worktrees: [] };
      let attempts = 0;
      const pending = h.worktree.createWorktreeInForm(h.show, context, async (request) => {
        assert.equal(request.newBranch, 'topic');
        if (++attempts === 1) { throw new Error('Worktree creation failed'); }
      });
      const values = { ...h.models.worktreeCreateForm(context).values, path: join(parent, 'next'), newBranch: 'topic' };
      await h.receive({ type: 'formSubmit', values });
      assert.equal(h.disposed, false);
      await h.receive({ type: 'formSubmit', values });
      assert.equal(await pending, true);
      assert.equal(attempts, 2);
    } finally {
      fs.rmSync(parent, { recursive: true, force: true });
    }
  });

  for (const annotated of [false, true]) {
    it(`creates ${annotated ? 'annotated' : 'lightweight'} tags through the shared form`, async () => {
      const h = harness();
      const cli = mockGitCli({ execRead: async (args) => ({ stdout: args[0] === 'remote' ? 'origin\nupstream\n' : 'true\n' }) });
      const pending = h.refs.runRefsMutation(cli.cli, {
        op: annotated ? 'tagCreateAnnotated' : 'tagCreateLight', objectRef: 'main',
      }, 'main', 'HEAD', h.show);
      // Annotated tags use the repository signing default without exposing a signing toggle.
      await new Promise((resolve) => setImmediate(resolve));
      await h.receive({ type: 'formReady' });
      const init = h.messages.find((message) => message.type === 'formInit');
      assert.equal(init?.type, 'formInit');
      if (init?.type !== 'formInit') { throw new Error('Missing tag form'); }
      assert.equal(init.form.fields.some((field) => field.id === 'sign'), false);
      await h.receive({ type: 'formSubmit', values: { ...init.form.values, name: '--delete' } });
      assert.equal(cli.writes.length, 0);
      await h.receive({ type: 'formSubmit', values: {
        ...init.form.values, name: 'v1.0', message: 'Release',
      } });
      assert.equal(await pending, true);
      assert.deepEqual(cli.writes.map((args) => Array.from(args)), annotated
        ? [['tag', '-a', 'v1.0', '-m', 'Release', '-s', 'main']]
        : [['tag', 'v1.0', 'main']]);
    });
  }

  it('pushes an annotated tag to every remote when requested', async () => {
    const h = harness();
    const cli = mockGitCli({ execRead: async (args) => ({ stdout: args[0] === 'remote' ? 'origin\nupstream\n' : '' }) });
    const pending = h.refs.runRefsMutation(cli.cli, { op: 'tagCreateAnnotated', objectRef: 'main' }, 'main', 'HEAD', h.show);
    await new Promise((resolve) => setImmediate(resolve));
    await h.receive({ type: 'formReady' });
    const init = h.messages.find((message) => message.type === 'formInit');
    assert.equal(init?.type, 'formInit');
    if (init?.type !== 'formInit') { throw new Error('Missing tag form'); }
    await h.receive({ type: 'formSubmit', values: {
      ...init.form.values, name: 'v1.0', message: '', pushAllRemotes: true,
    } });
    assert.equal(await pending, true);
    assert.deepEqual(cli.writes.map((args) => Array.from(args)), [
      ['tag', '-a', 'v1.0', '-m', '', '--no-sign', 'main'],
      ['push', 'origin', '--tags'],
      ['push', 'upstream', '--tags'],
    ]);
  });

  it('renames a branch through the shared form and includes the remote option', async () => {
    const h = harness();
    const cli = mockGitCli({ execRead: async () => ({ stdout: 'origin/main\n' }) });
    const pending = h.refs.runRefsMutation(cli.cli, {
      op: 'branchRename', name: 'main',
    }, 'main', 'HEAD', h.show);
    await new Promise((resolve) => setImmediate(resolve));
    await h.receive({ type: 'formReady' });
    const init = h.messages.find((message) => message.type === 'formInit');
    assert.equal(init?.type, 'formInit');
    if (init?.type !== 'formInit') { throw new Error('Missing rename form'); }
    assert.equal(init.form.values.name, 'main');
    assert.ok(init.form.fields.some((field) => field.id === 'renameRemote'));
    await h.receive({ type: 'formSubmit', values: {
      ...init.form.values, name: 'next', renameRemote: true,
    } });
    assert.equal(await pending, true);
    assert.deepEqual(cli.writes.map((args) => Array.from(args)), [
      ['branch', '-m', 'main', 'next'],
      ['push', 'origin', 'next:next'],
      ['push', 'origin', '--delete', 'main'],
      ['branch', '--set-upstream-to', 'origin/next', 'next'],
    ]);
  });

  it('deletes a remote branch through the shared form and prunes its tracking ref', async () => {
    const h = harness();
    const cli = mockGitCli();
    const pending = h.refs.runRefsMutation(cli.cli, {
      op: 'remoteBranchDelete', name: 'origin/agent/feature',
    }, 'main', 'HEAD', h.show);
    await new Promise((resolve) => setImmediate(resolve));
    await h.receive({ type: 'formReady' });
    const init = h.messages.find((message) => message.type === 'formInit');
    assert.equal(init?.type, 'formInit');
    if (init?.type !== 'formInit') { throw new Error('Missing remote delete form'); }
    assert.equal(init.form.title, 'Delete Branch');
    assert.equal(init.form.values.name, 'origin/agent/feature');
    await h.receive({ type: 'formSubmit', values: init.form.values });
    assert.equal(await pending, true);
    assert.deepEqual(cli.writes.map((args) => Array.from(args)), [
      ['push', 'origin', '--delete', 'agent/feature'],
      ['update-ref', '-d', 'refs/remotes/origin/agent/feature'],
    ]);
  });

  it('saves all stash changes with the message and untracked option', async () => {
    const h = harness();
    const requests: unknown[] = [];
    const pending = h.stash.createStashInForm(h.show, ['new.txt'], async (request) => { requests.push(request); },
      { currentBranch: 'main', load: async () => [
        { index: 0, selector: 'stash@{0}', sha: 'a'.repeat(40), message: ' WIP ' },
      ] });
    await h.receive({ type: 'formSubmit', values: { message: ' WIP ', includeUntracked: true, mode: 'all' } });
    assert.equal(await pending, true);
    assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ mode: 'all', message: 'WIP', includeUntracked: true }]);
  });

  it('preserves stash drafts when native file selection is cancelled and saves only selected files', async () => {
    const h = harness();
    const requests: unknown[] = [];
    const pending = h.stash.createStashInForm(h.show, ['a.txt', 'b.txt'], async (request) => { requests.push(request); },
      { currentBranch: 'main', load: async () => [
        { index: 0, selector: 'stash@{0}', sha: 'a'.repeat(40), message: 'Selected' },
      ] });
    const values = { message: 'Selected', includeUntracked: false, mode: 'paths' };
    await h.receive({ type: 'formSubmit', values });
    assert.equal(h.disposed, false);
    assert.equal(requests.length, 0);
    h.setPicked([{ label: 'b.txt' }]);
    await h.receive({ type: 'formSubmit', values });
    assert.equal(await pending, true);
    assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ mode: 'paths', message: 'Selected', paths: ['b.txt'] }]);
  });

  it('validates submodule drafts before running the operation callback', async () => {
    const h = harness();
    const requests: unknown[] = [];
    const pending = h.generic({
      validate: h.models.validateSubmoduleForm,
      submit: async (values) => { requests.push(h.models.submoduleFormRequest(values)); return true; },
    }, h.models.submoduleAddForm());
    await h.receive({ type: 'formSubmit', values: { url: '--bad', path: '../escape', recursive: false } });
    assert.equal(requests.length, 0);
    await h.receive({ type: 'formSubmit', values: { url: 'https://example.test/lib.git', path: 'vendor/lib', recursive: true } });
    assert.equal(await pending, true);
    assert.deepEqual(JSON.parse(JSON.stringify(requests)), [
      { url: 'https://example.test/lib.git', path: 'vendor/lib', branch: '', recursive: true },
    ]);
  });

  it('initializes the branch form with the existing prefix and checkout defaults', async () => {
    const h = harness();
    const pending = h.branch(mockGitCli().cli);
    await h.receive({ type: 'formReady' });
    assert.equal(h.form.fields.find((field) => field.id === 'name')?.description, 'The name of the new branch.');
    assert.equal(h.form.values.name, 'agent/');
    assert.equal(h.form.values.startPoint, 'main');
    assert.equal(h.form.values.checkout, true);
    assert.equal(h.form.values.localChanges, 'keep');
    assert.equal(h.messages.at(-1)?.type, 'formInit');
    assert.equal(h.revealed, 1);
    assert.equal(h.envelopes[0]?.type, 'operationFormOpen');
    h.panel.dispose();
    assert.equal(await pending, false);
  });

  it('validates inline and refuses invalid submissions without touching Git', async () => {
    const h = harness();
    const cli = mockGitCli();
    const pending = h.branch(cli.cli);
    await h.receive({ type: 'formValidate', version: 1, values: h.form.values });
    const validation = h.messages.at(-1);
    assert.equal(validation?.type, 'formValidation');
    if (validation?.type === 'formValidation') { assert.ok(validation.errors.name); }
    await h.receive({ type: 'formSubmit', values: { ...h.form.values, name: 'topic', startPoint: '--bad' } });
    const status = h.messages.at(-1);
    assert.equal(status?.type, 'formStatus');
    if (status?.type === 'formStatus') { assert.ok(status.errors?.startPoint); }
    assert.equal(cli.writes.length, 0);
    await h.receive({ type: 'formCancel' });
    assert.equal(await pending, false);
  });

  it('submits a branch through the existing Git operation and closes on success', async () => {
    const h = harness();
    const cli = mockGitCli();
    const pending = h.branch(cli.cli);
    await h.receive({ type: 'formSubmit', values: { ...h.form.values, name: 'agent/next' } });
    assert.equal(await pending, true);
    assert.deepEqual(cli.writes.map((args) => Array.from(args)), [['switch', '-c', 'agent/next', 'main']]);
    assert.equal(h.disposed, true);
  });

  it('keeps the form open when native discard confirmation is cancelled', async () => {
    const h = harness();
    const cli = mockGitCli();
    const pending = h.branch(cli.cli);
    await h.receive({ type: 'formSubmit', values: {
      ...h.form.values, name: 'topic', localChanges: 'discard',
    } });
    assert.equal(h.confirmations.length, 1);
    assert.equal(cli.writes.length, 0);
    assert.equal(h.disposed, false);
    h.panel.dispose();
    assert.equal(await pending, false);
  });

  it('requires native confirmation before executing the discard policy', async () => {
    const h = harness();
    h.setConfirmation('Discard');
    const cli = mockGitCli({ execRead: async () => ({ stdout: ' M changed.txt\n' }) });
    const pending = h.branch(cli.cli);
    await h.receive({ type: 'formSubmit', values: {
      ...h.form.values, name: 'topic', checkout: false, localChanges: 'discard',
    } });
    assert.equal(await pending, true);
    assert.equal(h.confirmations.length, 1);
    assert.deepEqual(cli.writes.map((args) => Array.from(args)), [
      ['reset', '--hard'], ['clean', '-fd'], ['branch', 'topic', 'main'],
    ]);
  });

  it('preserves the form after Git fails and allows a corrected retry', async () => {
    const h = harness();
    let attempts = 0;
    const cli = mockGitCli({ execWrite: async () => {
      if (attempts++ === 0) { throw new Error('Branch already exists'); }
    } });
    const pending = h.branch(cli.cli);
    await h.receive({ type: 'formSubmit', values: { ...h.form.values, name: 'existing' } });
    assert.equal(h.disposed, false);
    assert.ok(h.messages.some((message) => message.type === 'formStatus'
      && message.error?.includes('Branch already exists')));
    assert.equal(h.logged.length, 1);
    await h.receive({ type: 'formSubmit', values: { ...h.form.values, name: 'new' } });
    assert.equal(await pending, true);
  });

  it('blocks duplicate submissions and awaits an in-flight operation even if the tab closes', async () => {
    const h = harness();
    let finish: (value: boolean) => void = () => {};
    let submissions = 0;
    const pending = h.generic({
      validate: () => ({}),
      submit: () => { submissions++; return new Promise((resolve) => { finish = resolve; }); },
    });
    const values: OperationFormValues = { ...h.form.values, name: 'topic' };
    const first = h.receive({ type: 'formSubmit', values });
    await h.receive({ type: 'formSubmit', values });
    assert.equal(submissions, 1);
    h.panel.dispose();
    finish(true);
    await first;
    assert.equal(await pending, true);
  });
});
