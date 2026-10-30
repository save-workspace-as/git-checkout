// Retakes the screenshots of the extension in docs/screenshots, from an installed copy of it in a real VS Code window.
// macOS only: a window is captured with `screencapture`, so the shot has the title bar, traffic lights and shadow.
//
//   node .agents/skills/screenshots/scripts/run.mjs [--only 01,12] [--out docs/screenshots] [--no-package] [--keep-open]
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../../..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => { const at = args.indexOf(`--${name}`); return at >= 0 ? args[at + 1] : undefined; };

const out = resolve(repo, option('out') ?? 'docs/screenshots');
const only = option('only')?.split(',').map((id) => id.trim().padStart(2, '0'));
// A short path: VS Code's IPC socket path must stay under 103 characters.
const work = '/tmp/gcshots';
const wanted = (id) => !only || only.includes(id);
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const run = (cmd, cmdArgs, options = {}) => (execFileSync(cmd, cmdArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options }) ?? '').trim();

if (process.platform !== 'darwin') { throw new Error('The screenshots are captured with macOS `screencapture`.'); }
// A locked screen cannot be captured: every window fails with "could not create image from window".
if (/CGSSessionScreenIsLocked<\/key>\s*<true\/>/.test(execFileSync('sh', ['-c', 'ioreg -n Root -d1 -a'], { encoding: 'utf8' }).replace(/\s+/g, ''))) {
  throw new Error('The screen is locked. Unlock it, and keep it awake, while the screenshots are taken.');
}

// ---- setup: the extension, the demo repositories, VS Code -----------------------------------------------------------
mkdirSync(work, { recursive: true });
const vsix = join(work, 'gitcheckout.vsix');
if (!flag('no-package') || !existsSync(vsix)) {
  console.log('packaging the extension');
  run('npm', ['run', 'compile'], { cwd: repo });
  run('npm', ['run', 'package'], { cwd: repo });
  const built = run('sh', ['-c', 'ls -t *.vsix | head -1'], { cwd: repo });
  copyFileSync(join(repo, built), vsix);
  rmSync(join(repo, built));
}

// The commits of the demo are made by a person whose GitHub picture exists, so the graph shows real avatars.
const [authorName, authorEmail] = (option('author') ?? run('sh', ['-c', "git log --format='%an|%ae' | grep -v '\\[bot\\]' | head -1"], { cwd: repo })).split('|');
console.log(`demo repositories, commits by ${authorName}`);
run('sh', [join(here, 'demo-repos.sh'), repo, work, authorName, authorEmail], { stdio: 'inherit' });

// The file whose history, blame and merge the shots show: one that changed in a few commits.
const touched = run('sh', ['-c', "git log --name-only --format= | grep -E '\\.(ts|css)$' | sort | uniq -c | sort -rn"], { cwd: repo }).split('\n')
  .map((line) => line.trim().match(/^(\d+) (.+)$/)).filter(Boolean);
const historyFile = (touched.find((match) => Number(match[1]) === 4) ?? touched.find((match) => Number(match[1]) >= 3) ?? touched[0])[2];
console.log(`history of ${historyFile}`);

const swift = join(work, 'window');
if (!existsSync(swift)) { run('swiftc', ['-o', swift, join(here, 'window.swift')]); }

const { downloadAndUnzipVSCode } = await import(resolve(repo, 'node_modules/@vscode/test-electron/out/index.js'));
const code = await downloadAndUnzipVSCode('stable');

async function openWindow(folder, port) {
  const data = join(work, `profile-${port}`);
  rmSync(data, { recursive: true, force: true });
  mkdirSync(join(data, 'user', 'User'), { recursive: true });
  writeFileSync(join(data, 'user', 'User', 'settings.json'), JSON.stringify({
    'workbench.colorTheme': 'Default Dark Modern', 'workbench.startupEditor': 'none', 'workbench.tips.enabled': false,
    'workbench.welcomePage.walkthroughs.openOnInstall': false, 'workbench.secondarySideBar.defaultVisibility': 'hidden',
    'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoCheckUpdates': false, 'extensions.autoUpdate': false,
    'chat.disableAIFeatures': true, 'window.commandCenter': false, 'window.title': 'Git Checkout — ${rootName}',
    'window.titleBarStyle': 'custom', 'security.workspace.trust.enabled': false, 'editor.minimap.enabled': false,
    'git.autofetch': false, 'gitCheckout.autoFetch.enabled': false, 'gitCheckout.graph.githubAvatars': true, 'gitCheckout.graph.gravatar': false,
  }, null, 2));
  // The commands that open a modal for a file need the file; a key runs each.
  const context = { webviewSection: 'commitTree', commitTreeKind: 'blob', path: historyFile, preventDefaultContextMenuItems: true };
  writeFileSync(join(data, 'user', 'User', 'keybindings.json'), JSON.stringify([
    { key: 'ctrl+alt+shift+r', command: 'gitCheckout.interactiveRebase' },
    { key: 'ctrl+alt+shift+h', command: 'gitCheckout.pathHistory.file', args: context },
    { key: 'ctrl+alt+shift+b', command: 'gitCheckout.blame.file', args: context },
  ]));
  const cli = join(dirname(code), '..', 'Resources', 'app', 'bin', 'code');
  run(cli, ['--install-extension', vsix, '--user-data-dir', join(data, 'user'), '--extensions-dir', join(data, 'extensions')]);
  const child = spawn(code, [
    `--remote-debugging-port=${port}`, `--user-data-dir=${join(data, 'user')}`, `--extensions-dir=${join(data, 'extensions')}`,
    '--disable-workspace-trust', '--skip-welcome', '--skip-release-notes', '--disable-telemetry', '--new-window', folder,
  ], { stdio: 'ignore', detached: true });
  child.unref();
  let browser;
  for (let i = 0; i < 60 && !browser; i++) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => undefined);
    if (!browser) { await sleep(1000); }
  }
  if (!browser) { throw new Error('VS Code did not start'); }
  let page;
  for (let i = 0; i < 120 && !page; i++) {
    page = browser.contexts()[0]?.pages().find((candidate) => candidate.url().includes('workbench'));
    if (!page) { await sleep(500); }
  }
  if (!page) { throw new Error('the VS Code window did not open'); }
  await sleep(4000);
  return { browser, page, pid: child.pid };
}

// ---- helpers on a window ----------------------------------------------------------------------------------------------
function tools(window) {
  const { page, pid } = window;
  const find = async (test) => {
    for (let i = 0; i < 30; i++) {
      for (const frame of page.frames()) {
        if (frame.url().startsWith('vscode-webview://') && await frame.evaluate(test).catch(() => false)) { return frame; }
      }
      await sleep(400);
    }
    throw new Error(`no webview matched ${test}`);
  };
  const t = {
    page,
    find,
    graph: () => find(() => !!document.querySelector('.pane-graph')),
    async shot(id, name) {
      // A window that is behind another cannot be captured.
      await page.bringToFront();
      await page.mouse.move(2, 300);
      await sleep(900);
      let windowId = '';
      for (let i = 0; i < 10 && !windowId; i++) { windowId = run(swift, [String(pid)]); if (!windowId) { await sleep(500); } }
      mkdirSync(out, { recursive: true });
      try {
        execFileSync('screencapture', ['-x', `-l${windowId}`, join(out, `${id}-${name}.png`)], { stdio: 'pipe' });
      } catch (error) {
        throw new Error(`could not capture window ${windowId} of process ${pid}: ${error.stderr?.toString().trim() ?? error}`);
      }
      console.log(`saved ${id}-${name}.png`);
    },
    async command(title) {
      await page.keyboard.press('Meta+Shift+p'); await sleep(400);
      await page.keyboard.type(title); await sleep(600);
      await page.keyboard.press('Enter'); await sleep(800);
    },
    async openGitCheckout() {
      await page.locator('.activitybar .action-item').nth(5).click(); await sleep(800);
      await t.command('Git Checkout: Open'); await sleep(4000);
      await page.getByText('Worktrees', { exact: true }).first().click().catch(() => {});
    },
    tab: async (name) => { await page.getByRole('tab', { name: new RegExp(`^${name}`) }).first().click(); await sleep(1200); },
    maximize: async () => { await page.locator('.part.panel [aria-label="Maximize Panel"]').first().click(); await sleep(1000); },
    restore: async () => { await page.locator('.part.panel [aria-label="Restore Panel"]').first().click(); await sleep(1000); },
    /** The bottom panel drawn down to its tab bar, so a view above it has the room. */
    async collapsePanel() {
      const r = await page.evaluate(() => { const p = document.querySelector('.part.panel').getBoundingClientRect(); return { top: p.top, h: p.height }; });
      if (r.h < 120) { return; }
      await page.mouse.move(700, r.top - 2); await page.mouse.down();
      await page.mouse.move(700, r.top + 100, { steps: 6 }); await page.mouse.move(700, 800, { steps: 10 });
      await page.mouse.up(); await sleep(900);
    },
    async expandPanel() {
      const r = await page.evaluate(() => { const p = document.querySelector('.part.panel').getBoundingClientRect(); return { top: p.top, h: p.height }; });
      if (r.h > 200) { return; }
      await page.mouse.move(700, r.top - 2); await page.mouse.down();
      await page.mouse.move(700, r.top - 150, { steps: 8 }); await page.mouse.move(700, 570, { steps: 8 });
      await page.mouse.up(); await sleep(900);
    },
  };
  return t;
}

const pickCommit = async (graph, index) => { await graph.locator('.graph-row .graph-subject').nth(index).click(); await sleep(800); };
const clearSearch = async (graph, page) => {
  await graph.locator('vscode-textfield.graph-search').click();
  await page.keyboard.press('Meta+a'); await page.keyboard.press('Backspace'); await page.keyboard.press('Enter');
  await sleep(1200);
};
const closeWindow = (window) => { if (!flag('keep-open')) { try { process.kill(-window.pid); } catch { try { process.kill(window.pid); } catch { /* already gone */ } } } };

// ---- the shots --------------------------------------------------------------------------------------------------------
const stage = await openWindow(join(work, 'stage', 'git-checkout'), 9411);
try {
  const t = tools(stage);
  const { page } = t;
  await t.openGitCheckout();
  const graph = await t.graph();
  await t.expandPanel();
  await pickCommit(graph, 5);
  await t.tab('Commit');

  // The three modals and the graph with the bottom panel drawn down to its tab bar.
  await t.collapsePanel();
  if (wanted('08')) { await page.keyboard.press('Control+Alt+Shift+h'); await sleep(3500); await t.shot('08', 'file-history'); await page.keyboard.press('Escape'); await sleep(800); }
  if (wanted('09')) { await page.keyboard.press('Control+Alt+Shift+b'); await sleep(3500); await t.shot('09', 'blame'); await page.keyboard.press('Escape'); await sleep(800); }
  if (wanted('11')) {
    await page.keyboard.press('Control+Alt+Shift+r'); await sleep(1000);
    await page.keyboard.type('HEAD~4'); await page.keyboard.press('Enter'); await sleep(4000);
    await t.shot('11', 'interactive-rebase'); await page.keyboard.press('Escape'); await sleep(800);
  }
  await pickCommit(graph, 5);
  if (wanted('01')) { await t.shot('01', 'commit-graph'); }
  if (wanted('02')) {
    await graph.locator('vscode-textfield.graph-search').click();
    await page.keyboard.type(`path:${historyFile.split('/').slice(0, -1).join('/') || historyFile}`); await page.keyboard.press('Enter'); await sleep(2500);
    await t.shot('02', 'graph-search');
    await clearSearch(graph, page);
  }

  // The rest need the bottom panel open.
  await t.expandPanel();
  if (wanted('10')) { await pickCommit(graph, 5); await page.keyboard.press('Meta+p'); await sleep(1500); await t.shot('10', 'quick-launch'); await page.keyboard.press('Escape'); await sleep(600); }
  if (wanted('03') || wanted('13')) {
    await t.tab('Changes');
    await page.getByText(historyFile.split('/').pop()).first().click().catch(() => {}); await sleep(1500);
    await t.maximize();
    if (wanted('03')) { await t.shot('03', 'stage-and-unstage'); }
    if (wanted('13')) {
      const diff = await t.find(() => document.querySelectorAll('.commit-diff-line[data-line]').length > 0);
      const rows = diff.locator('.commit-diff-line[data-line]');
      const n = await rows.count();
      const a = await rows.nth(Math.max(0, n - 2)).boundingBox();
      const b = await rows.nth(Math.max(0, n - 1)).boundingBox();
      await page.mouse.move(a.x + 90, a.y + a.height / 2); await page.mouse.down();
      await page.mouse.move(b.x + 480, b.y + b.height / 2, { steps: 10 }); await page.mouse.up();
      await sleep(700);
      await t.shot('13', 'stage-lines');
    }
    await t.restore();
  }
  if (wanted('04')) { await pickCommit(graph, 5); await t.tab('Commit'); await t.maximize(); await t.shot('04', 'commit-details'); await t.restore(); }
  if (wanted('07')) {
    await graph.getByText('refresh the extension icon').first().click(); await sleep(800);
    await t.tab('Commit'); await t.maximize();
    await page.getByText('icon.png', { exact: true }).first().click(); await sleep(2500);
    await t.shot('07', 'image-diff'); await t.restore();
  }
  if (wanted('05') || wanted('06')) {
    await t.tab('File Tree'); await t.maximize();
    await page.getByText('src', { exact: true }).last().click().catch(() => {}); await sleep(800);
    if (wanted('05')) { await t.shot('05', 'file-tree'); }
    if (wanted('06')) {
      await page.getByText('resources', { exact: true }).last().click(); await sleep(800);
      await page.getByText('icon.png', { exact: true }).last().click(); await sleep(2000);
      await t.shot('06', 'image-preview');
    }
    await t.restore();
  }
  await stage.browser.close();
} finally {
  closeWindow(stage);
}

if (wanted('12')) {
  const merge = await openWindow(join(work, 'merge', 'git-checkout'), 9412);
  try {
    const t = tools(merge);
    await t.openGitCheckout();
    await t.page.keyboard.press('Meta+j'); await sleep(1500); // the bottom panel is not in this shot
    await t.page.getByRole('button', { name: 'Resolve', exact: true }).first().click().catch(async () => {
      const graph = await t.graph();
      await graph.getByText('Resolve', { exact: true }).first().click();
    });
    await sleep(3500);
    const modal = await t.find(() => !!document.querySelector('.merge-footer'));
    const cell = modal.locator('.merge-pane-current .merge-cell[data-conflict="0"][data-first]');
    await cell.hover(); await sleep(300);
    await cell.locator('.merge-pick').click(); await sleep(700);
    await t.shot('12', 'merge-conflict');
    await merge.browser.close();
  } finally {
    closeWindow(merge);
  }
}
console.log(`done: ${out}`);
