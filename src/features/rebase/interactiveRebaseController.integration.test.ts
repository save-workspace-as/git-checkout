import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import { initTempRepository } from '../../core/testing/gitRepoHarness';
import { mockCliRegistry, mockGitExtensionService, mockRepository } from '../../core/testing/serviceTestUtils';
import type { RebaseHostMessage } from '../../shared/rebase/rebaseProtocol';
import type { InteractiveRebaseController } from './interactiveRebaseController';

const code = buildSync({
  entryPoints: [join(__dirname, 'interactiveRebaseController.ts')],
  bundle: true, platform: 'node', format: 'cjs', write: false,
  external: ['vscode', '@vscode/l10n'],
}).outputFiles[0].text;

describe('interactive rebase commit details', () => {
  it('posts the real message body and committer and surfaces failed lookups', async () => {
    const repo = initTempRepository();
    try {
      await repo.cli.execWrite(['commit', '--allow-empty', '-m', 'Base']);
      const onto = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      await repo.cli.execWrite(['commit', '--allow-empty', '-m', 'Summary', '-m', 'Body paragraph\n\nMore detail']);
      const hash = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      const nativeRequire = createRequire(__filename);
      const warnings: unknown[][] = [];
      const module = { exports: {} as { InteractiveRebaseController: typeof InteractiveRebaseController } };
      runInNewContext(code, { module, process, Buffer, setTimeout, clearTimeout, require: (name: string) => {
        if (name === 'vscode') {
          return { window: { createOutputChannel: () => ({
            debug() {}, info() {}, trace() {}, error() {},
            warn: (...args: unknown[]) => warnings.push(args),
          }) } };
        }
        return nativeRequire(name);
      } });
      const controller = new module.exports.InteractiveRebaseController(
        mockGitExtensionService([mockRepository(repo.repoRoot)]), mockCliRegistry(repo.repoRoot, repo.cli),
      );
      const messages: RebaseHostMessage[] = [];
      controller.attachPoster((message) => messages.push(message));
      await controller.open(repo.repoRoot, onto);
      messages.length = 0;
      await controller.handleWebviewMessage({ type: 'rebaseRequestCommitDetails', hash });
      const details = messages[0];
      assert.equal(details?.type, 'rebaseCommitDetails');
      if (details?.type !== 'rebaseCommitDetails') { assert.fail('Missing commit details response'); }
      assert.equal(details.hash, hash);
      assert.equal(details.body, 'Body paragraph\n\nMore detail');
      assert.equal(details.committer.name, 'git-checkout-test');
      assert.equal(details.committer.email, 'test@git-checkout.local');
      assert.ok(details.committer.date > 0);
      messages.length = 0;
      const warningCount = warnings.length;
      await controller.handleWebviewMessage({ type: 'rebaseRequestCommitDetails', hash: 'missing-commit' });
      assert.equal(messages[0]?.type, 'rebaseCommitDetailsError');
      assert.ok(warnings.length > warningCount);
      controller.dispose();
    } finally {
      repo.cleanup();
    }
  });
});

describe('interactive rebase start', () => {
  type Harness = ReturnType<typeof initTempRepository>;

  async function withController(
    repo: Harness,
    run: (controller: InteractiveRebaseController, messages: RebaseHostMessage[]) => Promise<void>,
  ): Promise<void> {
    const nativeRequire = createRequire(__filename);
    const module = { exports: {} as { InteractiveRebaseController: typeof InteractiveRebaseController } };
    runInNewContext(code, { module, process, Buffer, setTimeout, clearTimeout, require: (name: string) => {
      if (name === 'vscode') {
        return { window: { createOutputChannel: () => ({ debug() {}, info() {}, trace() {}, error() {}, warn() {} }) } };
      }
      return nativeRequire(name);
    } });
    const controller = new module.exports.InteractiveRebaseController(
      mockGitExtensionService([mockRepository(repo.repoRoot)]), mockCliRegistry(repo.repoRoot, repo.cli),
    );
    const messages: RebaseHostMessage[] = [];
    controller.attachPoster((message) => messages.push(message));
    try {
      await run(controller, messages);
    } finally {
      controller.dispose();
    }
  }

  const commitFile = async (repo: Harness, text: string, message: string): Promise<string> => {
    writeFileSync(`${repo.repoRoot}/f.txt`, text);
    await repo.cli.execWrite(['add', 'f.txt']);
    await repo.cli.execWrite(['commit', '-m', message]);
    return (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
  };

  it('closes its window when the rebase runs to the end', async () => {
    const repo = initTempRepository();
    try {
      await repo.cli.execWrite(['commit', '--allow-empty', '-m', 'Base']);
      const onto = (await repo.cli.execRead(['rev-parse', 'HEAD'])).stdout.trim();
      await repo.cli.execWrite(['commit', '--allow-empty', '-m', 'One']);
      await withController(repo, async (controller, messages) => {
        await controller.open(repo.repoRoot, onto);
        messages.length = 0;
        await controller.handleWebviewMessage({ type: 'rebaseStart' });
        assert.deepEqual(messages.map((message) => message.type), ['rebaseClose']);
      });
    } finally {
      repo.cleanup();
    }
  });

  it('closes its window when a commit conflicts, leaving the rebase for the banner', async () => {
    const repo = initTempRepository();
    try {
      const onto = await commitFile(repo, 'base\n', 'Base');
      const first = await commitFile(repo, 'first\n', 'First');
      await commitFile(repo, 'first and second\n', 'Second');
      await withController(repo, async (controller, messages) => {
        await controller.open(repo.repoRoot, onto);
        // Without First, Second no longer applies.
        await controller.handleWebviewMessage({ type: 'rebaseSetCommand', hash: first, command: 'drop' });
        messages.length = 0;
        await controller.handleWebviewMessage({ type: 'rebaseStart' });
        assert.deepEqual(messages.map((message) => message.type), ['rebaseClose']);
        const status = (await repo.cli.execRead(['status', '--porcelain'])).stdout;
        assert.match(status, /^UU f\.txt$/m);
      });
    } finally {
      repo.cleanup();
    }
  });

  it('keeps its window and shows the error when the rebase never began', async () => {
    const repo = initTempRepository();
    try {
      const onto = await commitFile(repo, 'base\n', 'Base');
      await commitFile(repo, 'one\n', 'One');
      await withController(repo, async (controller, messages) => {
        await controller.open(repo.repoRoot, onto);
        // Git refuses to rebase over uncommitted changes, unless they are stashed first.
        writeFileSync(`${repo.repoRoot}/f.txt`, 'uncommitted\n');
        messages.length = 0;
        await controller.handleWebviewMessage({ type: 'rebaseStart' });
        assert.deepEqual(messages.map((message) => message.type), ['rebaseError']);
      });
    } finally {
      repo.cleanup();
    }
  });
});
