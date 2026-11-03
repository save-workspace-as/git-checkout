// The scenes of the demo video, in the order of demo-video.md. run.mjs calls `tour(...)` with its helpers while a screen
// recording runs, so each scene waits long enough to be read.
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** What is said in each scene; a scene lasts at least as long as its sentence. */
export const narration = {
  1: "This is Git Checkout. [[slnc 250]] Your history, as a graph, with every branch and tag, and the faces of the people behind each commit.",
  2: "Pick a commit, [[slnc 200]] and its changed files are listed in the sidebar. [[slnc 250]] Open any of them, and the diff appears right in the editor.",
  3: "Need something specific? [[slnc 250]] Search the graph by message, author, or path, and it narrows to just the commits that matter.",
  4: "Staging happens in the sidebar. [[slnc 250]] Open a change, select a few lines, and stage or discard only those.",
  5: "Quick Launch puts every action one keystroke away.",
  6: "Open the history of any file, [[slnc 250]] and see who last touched each line.",
  7: "Blame also lives in the editor. [[slnc 250]] At the end of the line, in the gutter for the whole file, and above each function.",
  8: "And when history needs a rewrite, [[slnc 250]] interactive rebase lets you reorder, squash, or drop commits, with the whole plan in front of you.",
};

export async function tour({ t, page, graph, historyFile, changedFile, scene }) {
  const pick = async (index) => { await graph.locator('.graph-row .graph-subject').nth(index).click(); await sleep(800); };

  await scene(1, 'The graph', async () => {
    await t.layout('Repositories', 'Commit');
    await sleep(4000);
  });

  await scene(2, 'Look into a commit', async () => {
    // A commit that changes code, not a release that only bumps versions.
    const code = graph.locator('.graph-row .graph-subject').filter({ hasText: /^refactor/ }).first();
    await t.glide(code);
    await code.click();
    await sleep(800);
    await t.layout('Commit');
    await sleep(1500);
    await t.clickFirstRow('Commit');
    await sleep(4000);
    await t.closeTab();
    await t.showGraph();
  });

  await scene(3, 'Search', async () => {
    await t.glide(graph.locator('vscode-textfield.graph-search'));
    await graph.locator('vscode-textfield.graph-search').click();
    await page.keyboard.type(`path:${historyFile.split('/').slice(0, -1).join('/') || historyFile}`, { delay: 70 });
    await page.keyboard.press('Enter');
    await sleep(3500);
    await graph.locator('vscode-textfield.graph-search').click();
    await page.keyboard.press('Meta+a'); await page.keyboard.press('Backspace'); await page.keyboard.press('Enter');
    await sleep(1500);
  });

  await scene(4, 'Stage', async () => {
    await t.layout('Commit Message', 'Changes');
    await t.setHeight('Commit Message', 240);
    await t.clickRow(changedFile.split('/').pop());
    await sleep(2500);
    const diff = await t.find(() => document.querySelectorAll('.commit-diff-line[data-line]').length > 0);
    const rows = diff.locator('.commit-diff-line[data-line]');
    const n = await rows.count();
    const a = await rows.nth(Math.max(0, n - 2)).boundingBox();
    const b = await rows.nth(Math.max(0, n - 1)).boundingBox();
    await page.mouse.move(a.x + 90, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + 480, b.y + b.height / 2, { steps: 20 }); await page.mouse.up();
    await sleep(3500);
    await t.closeTab();
    await t.showGraph();
  });

  await scene(5, 'Quick Launch', async () => {
    await page.keyboard.press('Meta+p');
    await sleep(4000);
    await page.keyboard.press('Escape');
    await sleep(600);
  });

  // A file of the File Tree: open each folder of its path, the way a person looks for it.
  const openInTree = async () => {
    await t.layout('File Tree');
    const parts = historyFile.split('/');
    for (const folder of parts.slice(0, -1)) {
      const row = t.row(folder);
      await t.glide(row);
      await row.click();
      await sleep(700);
    }
    // The list draws only the rows in view; scroll until the file is one of them.
    const file = t.row(parts.at(-1));
    const list = page.locator('.pane-body .monaco-list-row').first();
    const box = await list.boundingBox();
    for (let i = 0; i < 15 && await file.count() === 0; i++) {
      await page.mouse.move(box.x + 120, box.y + 120);
      await page.mouse.wheel(0, 160);
      await sleep(500);
    }
    return file;
  };

  await scene(6, 'File history and blame', async () => {
    const file = await openInTree();
    await t.menu(file, 'File History');
    await sleep(4500);
    await page.keyboard.press('Escape'); await sleep(900);
    await t.menu(file, 'Blame File');
    await sleep(4500);
    await page.keyboard.press('Escape'); await sleep(900);
  });

  await scene(7, 'Blame in the editor', async () => {
    await t.typed('Go to File');
    await page.keyboard.type(historyFile.split('/').pop(), { delay: 70 }); await sleep(900);
    await page.keyboard.press('Enter'); await sleep(2500);
    await page.keyboard.press('Control+g'); await sleep(500);
    await page.keyboard.type('20', { delay: 90 }); await page.keyboard.press('Enter'); await sleep(300);
    await page.keyboard.press('End'); await sleep(1500);
    await page.keyboard.press('Meta+k'); await page.keyboard.press('Meta+i'); await sleep(3500);
    await page.keyboard.press('Escape');
    await t.typed('Git Checkout: Toggle File Blame'); await sleep(2500);
    await t.typed('Git Checkout: Toggle Git CodeLens'); await sleep(3500);
    await t.closeTab();
    await t.showGraph();
  });

  await scene(8, 'Interactive rebase', async () => {
    // Right-click a commit a few steps back, rebase onto it, squash one commit and drop another, and run it.
    const commit = graph.locator('.graph-row .graph-subject').nth(9);
    await t.menu(commit, 'Interactive Rebase onto Here');
    await sleep(3000);
    const modal = await t.find(() => !!document.querySelector('.rebase-list'));
    const rows = modal.locator('.rebase-list [data-index]');
    const choose = async (index, action) => {
      const select = rows.nth(index).locator('vscode-single-select.rebase-cmd');
      await t.glide(select);
      await select.click();
      await sleep(700);
      const option = modal.getByRole('option', { name: action, exact: true }).first();
      await t.glide(option);
      await option.click();
      await sleep(900);
    };
    await choose(1, 'squash');
    await choose(3, 'drop');
    await sleep(1500);
    const stash = modal.locator('vscode-checkbox').filter({ hasText: 'Stash and reapply' });
    await t.glide(stash); await stash.click(); await sleep(700);
    const go = modal.locator('vscode-button', { hasText: /^Rebase$/ });
    await t.glide(go); await go.click();
    await sleep(5000);
  });
}
