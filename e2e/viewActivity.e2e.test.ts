import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';

import { bindExtension, changeGroupRows, git, repoRoot, waitFor } from './harness';

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('Views out of sight', () => {
  const ctx = bindExtension();
  const listed = async (file: string): Promise<boolean> => (await changeGroupRows(ctx.api, 'unstaged')).some((row) => row.path === file);

  afterEach(() => {
    ctx.api.pretendWindowFocused(undefined);
    ctx.api.keepViewsFresh(true);
  });

  it('read the changes once when the Changes view is shown, and not while it is hidden', async () => {
    // The same steps with every view kept fresh do show the change, so the wait below is the gate and nothing else.
    writeFileSync(join(repoRoot(), 'control.txt'), 'x\n');
    await vscode.commands.executeCommand('git.refresh');
    await waitFor('the control change', async () => ((await listed('control.txt')) ? true : undefined));

    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    // The sidebar of an earlier test can still be on its way up; the views stay out of sight only once it has settled.
    await pause(1500);
    await vscode.commands.executeCommand('workbench.action.closeSidebar');
    await waitFor('the Changes views to be out of sight', async () => (ctx.api.changesOnScreen() ? undefined : true));
    // A headless window shows nothing, so tests keep every view fresh; here it is turned off, with the window in front.
    ctx.api.keepViewsFresh(false);
    ctx.api.pretendWindowFocused(true);

    writeFileSync(join(repoRoot(), 'while-hidden.txt'), 'x\n');
    git('branch', 'moved-while-hidden');
    await vscode.commands.executeCommand('git.refresh');
    await pause(1500);
    assert.equal(await listed('while-hidden.txt'), false);

    await vscode.commands.executeCommand('gitCheckout.changes.focus');
    await waitFor('the change, once the view is shown', async () => ((await listed('while-hidden.txt')) ? true : undefined));
  });

  it('read nothing while the window is in the background, and catch up when it comes back', async () => {
    await vscode.commands.executeCommand('gitCheckout.changes.focus');
    await pause(500);
    ctx.api.keepViewsFresh(false);
    ctx.api.pretendWindowFocused(false);

    writeFileSync(join(repoRoot(), 'while-away.txt'), 'x\n');
    git('branch', 'moved-while-away');
    await vscode.commands.executeCommand('git.refresh');
    await pause(1500);
    assert.equal(await listed('while-away.txt'), false);

    ctx.api.pretendWindowFocused(true);
    await waitFor('the change, once the window is back', async () => ((await listed('while-away.txt')) ? true : undefined));
  });
});
