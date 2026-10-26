import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { buildSync } from 'esbuild';
import * as l10n from '@vscode/l10n';
import type { OperationFormDefinition, OperationFormValues } from '../../shared/forms/operationForm';

const code = buildSync({
  entryPoints: [`${__dirname}/setUpstreamHost.ts`],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  write: false,
  external: ['vscode', '@vscode/l10n'],
}).outputFiles[0].text;

describe('set upstream form', () => {
  it('offers remote branches, prefills the current upstream, and validates the selection', async () => {
    const warnings: string[] = [];
    const vscode = {
      window: { showWarningMessage: async (message: string) => { warnings.push(message); } },
    };
    const module = { exports: {} as {
      promptUpstreamRef(
        snapshot: unknown,
        branchName: string,
        show: (form: OperationFormDefinition, handler: {
          validate(values: OperationFormValues): Record<string, string>;
          submit(values: OperationFormValues): Promise<boolean>;
        }) => Promise<boolean>,
      ): Promise<string | null>;
    } };
    runInNewContext(code, {
      module,
      require: (name: string) => name === 'vscode' ? vscode : l10n,
    });
    const snapshot = {
      branches: [{ name: 'main', upstream: 'origin/main' }],
      remoteBranches: [
        { name: 'origin/HEAD', shortSha: 'aaa' },
        { name: 'origin/main', shortSha: 'bbb' },
        { name: 'upstream/main', shortSha: 'ccc' },
      ],
    };
    let shown: OperationFormDefinition | undefined;
    let validation: Record<string, string> | undefined;
    const result = await module.exports.promptUpstreamRef(snapshot, 'main', async (form, handler) => {
      shown = form;
      validation = handler.validate({ upstream: 'origin/HEAD' });
      assert.equal(validation.upstream, 'Choose a remote-tracking branch.');
      assert.equal(await handler.submit({ upstream: 'upstream/main' }), true);
      return true;
    });
    assert.equal(result, 'upstream/main');
    assert.deepEqual(warnings, []);
    assert.equal(shown?.values.upstream, 'origin/main');
    const upstreamField = shown?.fields.find((field) => field.id === 'upstream');
    assert.equal(upstreamField?.type, 'text');
    if (upstreamField?.type !== 'text') { throw new Error('Missing upstream field'); }
    assert.deepEqual(Array.from(upstreamField.suggestions ?? [], (item) => [item.value, item.label]), [
      ['origin/main', 'origin/main (current)'],
      ['upstream/main', 'upstream/main'],
    ]);
  });
});
