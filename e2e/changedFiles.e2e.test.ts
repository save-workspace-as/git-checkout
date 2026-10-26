import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import * as vscode from 'vscode';

import { bindExtension, git, repoRoot, waitFor, type RevisionRow } from './harness';

describe('Changes tab file list', () => {
  const ctx = bindExtension();

  /** The rows of the native Changed Files view: folders end with `/`, their rows are indented. */
  async function rows(nodes?: RevisionRow[], depth = 0): Promise<string[]> {
    const level = nodes ?? ((await ctx.api.revisionLists.commitFiles.getChildren()) as RevisionRow[]);
    const out: string[] = [];
    for (const node of level) {
      out.push(`${'  '.repeat(depth)}${node.kind === 'dir' ? `${node.label}/` : node.path}`);
      if (node.kind === 'dir') {
        out.push(...(await rows(node.children ?? [], depth + 1)));
      }
    }
    return out;
  }

  const paths = (): string[] | undefined => ctx.api.commitFiles()?.files.map((file) => file.path).sort();

  it('lists the files of the selected commit or comparison', async () => {
    const commit = (file: string, message: string): string => {
      writeFileSync(join(repoRoot(), file), `${message}\n`);
      git('add', file);
      git('commit', '-m', message);
      return git('rev-parse', 'HEAD');
    };
    const first = commit('one.txt', 'one');
    const second = commit('two.ts', 'two');
    const third = commit('three.ts', 'three');

    await ctx.api.sendPanelMessage({ type: 'commitDetailsSelect', sha: second });
    await waitFor('files of one commit', async () => (paths()?.join() === 'two.ts' ? true : undefined));
    assert.equal(ctx.api.commitFiles()?.baseSha, undefined);

    await ctx.api.sendPanelMessage({ type: 'commitDetailsSelect', sha: third, baseSha: first });
    await waitFor('files of the comparison', async () => (paths()?.join() === 'three.ts,two.ts' ? true : undefined));
    assert.equal(ctx.api.commitFiles()?.baseSha, first);
  });

  it('shows the commit in the native Changed Files view, with menu contexts, and follows the list mode', async () => {
    mkdirSync(join(repoRoot(), 'pkg'), { recursive: true });
    writeFileSync(join(repoRoot(), 'pkg/a.ts'), 'a\n');
    writeFileSync(join(repoRoot(), 'b.ts'), 'b\n');
    git('add', '.');
    git('commit', '-m', 'two files');
    const sha = git('rev-parse', 'HEAD');
    await ctx.api.sendPanelMessage({ type: 'commitDetailsSelect', sha });
    await waitFor('files listed', async () => ((await rows()).join() === 'b.ts,pkg/a.ts' ? true : undefined));

    const listed = (await ctx.api.revisionLists.commitFiles.getChildren()) as RevisionRow[];
    const first = listed.find((row) => row.path === 'pkg/a.ts')!;
    assert.equal(first.revision, sha);
    assert.equal(first.status, 'A');
    assert.equal(first.commitTreeKind, 'blob');
    const item = await ctx.api.revisionLists.commitFiles.getTreeItem(first);
    assert.equal(item.contextValue, 'rev.file');
    assert.equal(item.resourceUri?.path, '/pkg/a.ts');

    await vscode.commands.executeCommand('gitCheckout.diff.fileTree');
    await waitFor('folders listed', async () =>
      (await rows()).join('|') === 'pkg/|  pkg/a.ts|b.ts' ? true : undefined,
    );
    await vscode.commands.executeCommand('gitCheckout.diff.fileFlat');

    // The same context opens the diff, and several rows copy all their paths.
    const all = (await ctx.api.revisionLists.commitFiles.getChildren()) as RevisionRow[];
    await vscode.env.clipboard.writeText('');
    await vscode.commands.executeCommand('gitCheckout.file.copyPath', all[0], all);
    assert.equal(await vscode.env.clipboard.readText(), 'b.ts\npkg/a.ts');
  });
});
