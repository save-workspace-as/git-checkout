// Retakes the screenshots of the extension in docs/screenshots, from an installed copy of it in a real VS Code window.
// macOS only: a window is captured with `screencapture`, so the shot has the title bar, traffic lights and shadow.
//
//   node .agents/skills/screenshots/scripts/run.mjs [--only 01,12] [--out docs/screenshots] [--no-package] [--keep-open]
//   node .agents/skills/screenshots/scripts/run.mjs --video [--out docs/demo.mov]   records the tour of demo-video.md instead
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

const video = flag('video');
const out = resolve(repo, option('out') ?? (video ? 'docs/demo.mov' : 'docs/screenshots'));
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

// The file the demo changed but did not stage, for the shots of the Changes section.
const changedFile = run('sh', ['-c', "git status --porcelain | grep '^ M' | head -1 | cut -c4-"], { cwd: join(work, 'stage', 'git-checkout') });
console.log(`unstaged change in ${changedFile}`);

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
    'window.titleBarStyle': 'custom', 'window.menuStyle': 'custom', 'security.workspace.trust.enabled': false, 'editor.minimap.enabled': false,
    'git.autofetch': false, 'gitCheckout.pullRequests.enabled': false, 'typescript.validate.enable': false, 'javascript.validate.enable': false, 'git.blame.statusBarItem.enabled': false, 'gitCheckout.autoFetch.enabled': false, 'gitCheckout.graph.githubAvatars': true, 'gitCheckout.graph.gravatar': false,
  }, null, 2));
  // The commands that open a modal for a file need the file; a key runs each.
  const context = { webviewSection: 'commitTree', commitTreeKind: 'blob', path: historyFile, preventDefaultContextMenuItems: true };
  writeFileSync(join(data, 'user', 'User', 'keybindings.json'), JSON.stringify([
    { key: 'ctrl+alt+shift+r', command: 'gitCheckout.interactiveRebase' },
    { key: 'ctrl+alt+shift+h', command: 'gitCheckout.pathHistory.file', args: context },
    { key: 'ctrl+alt+shift+b', command: 'gitCheckout.blame.file', args: context },
    { key: 'ctrl+alt+shift+o', command: 'workbench.action.quickOpen', args: historyFile.split('/').pop() },
    { key: 'ctrl+alt+shift+f', command: 'gitCheckout.blame.toggleFile' },
    { key: 'ctrl+alt+shift+l', command: 'gitCheckout.blame.toggleCodeLens' },
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
      await t.command('View: Show Git Checkout'); await sleep(800);
      await t.command('Git Checkout: Open'); await sleep(4000);
    },
    /** Opens or folds one collapsible of the Git Checkout sidebar. */
    async section(name, open) {
      const header = page.locator('.pane-header').filter({ has: page.locator('.title', { hasText: new RegExp(`^${name}$`, 'i') }) }).first();
      if (await header.count() === 0) { return; }
      const expanded = (await header.getAttribute('aria-expanded')) === 'true';
      if (expanded !== open) { await t.glide(header); await header.click(); await sleep(700); }
    },
    /** Opens exactly the collapsibles named, so the ones shown have the room. */
    async layout(...open) {
      for (const name of SECTIONS) { await t.section(name, open.includes(name)); }
      await sleep(600);
    },
    /** A row of a native list in the sidebar, by its text. */
    row: (text) => page.locator('.pane-body .monaco-list-row').filter({ hasText: text }).first(),
    /** In the video the pointer travels to the target and taps before the click, so a viewer sees where. */
    async glide(locator) {
      if (!video) { return; }
      const box = await locator.boundingBox();
      if (!box) { return; }
      await page.mouse.move(box.x + Math.min(box.width / 2, 120), box.y + box.height / 2);
      await sleep(700);
      await page.evaluate(() => window.__demoCursor?.tap());
    },
    /** Right-clicks a target and picks an item of the menu VS Code draws, the way a person would. */
    async menu(locator, item) {
      await t.glide(locator);
      await locator.click({ button: 'right' });
      await sleep(900);
      const entry = page.locator('.context-view .action-label').filter({ hasText: item }).first();
      await t.glide(entry);
      await entry.click();
      await sleep(1500);
    },
    /** Types into the Command Palette and runs the first match, slowly enough to read. */
    async typed(title) {
      await page.keyboard.press('Meta+Shift+p'); await sleep(600);
      await page.keyboard.type(title, { delay: 60 }); await sleep(900);
      await page.keyboard.press('Enter'); await sleep(1200);
    },
    async clickRow(text) { await t.glide(t.row(text)); await t.row(text).click(); await sleep(1800); },
    /** Sets the height of one collapsible by dragging the sash at its bottom edge. */
    async setHeight(name, px) {
      const pane = page.locator('.pane').filter({ has: page.locator('.pane-header .title', { hasText: new RegExp(`^${name}$`, 'i') }) }).first();
      const box = await pane.boundingBox();
      if (!box) { return; }
      const x = box.x + box.width / 2;
      const y = box.y + box.height;
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x, y - (box.height - px), { steps: 8 }); await page.mouse.up(); await sleep(600);
    },
    /** Closes the tab in front, the diff or the preview a shot opened. */
    async closeTab() { await page.keyboard.press('Meta+w'); await sleep(700); },
    /** Brings the graph forward again after a diff or a preview opened in front of it. */
    async showGraph() { await page.locator('.tabs-container .tab').filter({ hasText: /^Git Checkout/ }).first().click(); await sleep(900); },
    /** The first row of the list in one collapsible. */
    async clickFirstRow(name) {
      const pane = page.locator('.pane').filter({ has: page.locator('.pane-header .title', { hasText: new RegExp(`^${name}$`, 'i') }) }).first();
      await t.glide(pane.locator('.monaco-list-row').first()); await pane.locator('.monaco-list-row').first().click(); await sleep(1800);
    },
  };
  return t;
}

/** A pointer drawn over the window, since the automation moves no real one: it glides to where the mouse is sent and ripples on a tap. */
async function showCursor(page) {
  await page.evaluate(() => {
    const cursor = document.createElement('div');
    cursor.style.cssText = 'position:fixed;left:0;top:0;width:28px;height:28px;z-index:2147483647;pointer-events:none;transition:transform .55s cubic-bezier(.3,.7,.3,1);transform:translate(600px,400px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.6))';
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '28'); svg.setAttribute('height', '28'); svg.setAttribute('viewBox', '0 0 24 24');
    const arrow = document.createElementNS(ns, 'path');
    arrow.setAttribute('d', 'M4 2l15 9-6.5 1.5L9 19z'); arrow.setAttribute('fill', '#fff'); arrow.setAttribute('stroke', '#000');
    arrow.setAttribute('stroke-width', '1.5'); arrow.setAttribute('stroke-linejoin', 'round');
    svg.append(arrow); cursor.append(svg);
    document.body.append(cursor);
    const style = document.createElement('style');
    style.append('@keyframes demo-ripple{from{transform:translate(-50%,-50%) scale(.3);opacity:.9}to{transform:translate(-50%,-50%) scale(1.8);opacity:0}}');
    document.head.append(style);
    let x = 600; let y = 400;
    window.__demoCursor = {
      move(nx, ny) { x = nx; y = ny; cursor.style.transform = `translate(${nx - 4}px,${ny - 2}px)`; },
      tap() {
        const ring = document.createElement('div');
        ring.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:44px;height:44px;border-radius:50%;border:3px solid #3794ff;background:rgba(55,148,255,.25);z-index:2147483646;pointer-events:none;animation:demo-ripple .6s ease-out forwards`;
        document.body.append(ring);
        setTimeout(() => ring.remove(), 700);
      },
    };
  });
  const move = page.mouse.move.bind(page.mouse);
  const down = page.mouse.down.bind(page.mouse);
  page.mouse.move = async (x, y, options) => { await move(x, y, options); await page.evaluate(([nx, ny]) => window.__demoCursor?.move(nx, ny), [x, y]).catch(() => {}); };
  page.mouse.down = async (options) => { await page.evaluate(() => window.__demoCursor?.tap()).catch(() => {}); await down(options); };
}

const SECTIONS = ['Repositories', 'Commit Message', 'Changes', 'Commit', 'File Tree', 'Repository', 'Pull Requests'];
const pickCommit = async (graph, index) => { await graph.locator('.graph-row .graph-subject').nth(index).click(); await sleep(800); };
const clearSearch = async (graph, page) => {
  await graph.locator('vscode-textfield.graph-search').click();
  await page.keyboard.press('Meta+a'); await page.keyboard.press('Backspace'); await page.keyboard.press('Enter');
  await sleep(1200);
};
// Ask the window to quit itself; a SIGTERM would leave "The window terminated unexpectedly" behind.
const closeWindow = async (window) => {
  if (flag('keep-open')) { return; }
  try {
    // The window quits before it can answer, so the reply is not waited for.
    (await window.browser.newBrowserCDPSession()).send('Browser.close').catch(() => {});
    await sleep(2500);
  } catch {
    try { process.kill(-window.pid); } catch { try { process.kill(window.pid); } catch { /* already gone */ } }
  }
};

// ---- the video: the scenes of demo-video.md, recorded as the rectangle of the window ---------------------------------------
if (video) {
  const { tour, narration } = await import('./tour.mjs');
  // The narration is spoken by the system voice: one clip per scene, laid on the recording afterwards.
  const clips = {};
  for (const [number, text] of Object.entries(narration)) {
    const file = join(work, `scene-${number}.aiff`);
    run('say', ['-v', option('voice') ?? 'Samantha', '-r', '160', '-o', file, text]);
    clips[number] = { file, seconds: Number(run('sh', ['-c', `afinfo ${file} | awk '/estimated duration/ {print $3}'`])) };
  }
  const mux = join(work, 'mux');
  if (!existsSync(mux)) { mkdirSync(join(work, 'mux-src'), { recursive: true }); copyFileSync(join(here, 'mux.swift'), join(work, 'mux-src', 'main.swift')); run('swiftc', ['-o', mux, join(work, 'mux-src', 'main.swift')]); }
  const stage = await openWindow(join(work, 'stage', 'git-checkout'), 9411);
  try {
    const t = tools(stage);
    const { page } = t;
    await page.bringToFront();
    await showCursor(page);
    await t.openGitCheckout();
    const graph = await t.graph();
    const box = await page.evaluate(() => ({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight }));
    mkdirSync(dirname(out), { recursive: true });
    rmSync(out, { force: true });
    // The recording stops with SIGINT, which is what makes screencapture finish the file.
    const recorder = spawn('screencapture', ['-v', '-x', `-R${box.x},${box.y},${box.w},${box.h}`, out], { stdio: 'ignore' });
    await sleep(1500);
    const started = Date.now();
    const offsets = {};
    const chosen = option('scenes')?.split(',');
    const scene = async (number, title, play) => {
      if (chosen && !chosen.includes(String(number))) { return; }
      console.log(`scene ${number}: ${title}`);
      offsets[number] = (Date.now() - started) / 1000 + 1.5;
      const begun = Date.now();
      await play();
      // The scene lasts as long as its sentence, so the voice is never cut off by the next thing on screen.
      await sleep(Math.max(0, (clips[number].seconds + 1) * 1000 - (Date.now() - begun)));
    };
    try {
      await tour({ t, page, graph, historyFile, changedFile, scene });
    } finally {
      await sleep(1000);
      recorder.kill('SIGINT');
      await new Promise((done) => recorder.on('exit', done));
    }
    const final = out.replace(/\.mov$/, '.mp4');
    run(mux, [out, final, ...Object.keys(clips).flatMap((number) => [String(offsets[number]), clips[number].file])]);
    rmSync(out);
    console.log(`recorded ${final}`);
  } finally {
    await closeWindow(stage);
  }
  process.exit(0);
}

// ---- the shots --------------------------------------------------------------------------------------------------------
const stage = await openWindow(join(work, 'stage', 'git-checkout'), 9411);
try {
  const t = tools(stage);
  const { page } = t;
  await t.openGitCheckout();
  const graph = await t.graph();
  await pickCommit(graph, 5);
  await t.layout('Changes');

  // The three modals, over the graph.
  if (wanted('08')) { await page.keyboard.press('Control+Alt+Shift+h'); await sleep(3500); await t.shot('08', 'file-history'); await page.keyboard.press('Escape'); await sleep(800); }
  if (wanted('09')) { await page.keyboard.press('Control+Alt+Shift+b'); await sleep(3500); await t.shot('09', 'blame'); await page.keyboard.press('Escape'); await sleep(800); }
  if (wanted('11')) {
    await page.keyboard.press('Control+Alt+Shift+r'); await sleep(1000);
    await page.keyboard.type('HEAD~4'); await page.keyboard.press('Enter'); await sleep(4000);
    await t.shot('11', 'interactive-rebase'); await page.keyboard.press('Escape'); await sleep(800);
  }
  await pickCommit(graph, 5);
  if (wanted('01')) { await t.layout('Commit'); await t.shot('01', 'commit-graph'); }
  if (wanted('02')) {
    await graph.locator('vscode-textfield.graph-search').click();
    await page.keyboard.type(`path:${historyFile.split('/').slice(0, -1).join('/') || historyFile}`); await page.keyboard.press('Enter'); await sleep(2500);
    await t.shot('02', 'graph-search');
    await clearSearch(graph, page);
  }
  if (wanted('10')) { await pickCommit(graph, 5); await page.keyboard.press('Meta+p'); await sleep(1500); await t.shot('10', 'quick-launch'); await page.keyboard.press('Escape'); await sleep(600); }

  // A change picked in the sidebar opens its diff as a tab beside the graph.
  if (wanted('03') || wanted('13')) {
    await t.layout('Commit Message', 'Changes');
    await t.setHeight('Commit Message', 240);
    await t.clickRow(changedFile.split('/').pop());
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
    await t.closeTab();
  }
  // A file of a commit opens its diff the same way.
  if (wanted('04')) { await t.showGraph(); await t.layout('Commit'); await pickCommit(graph, 5); await t.clickRow('.ts'); await t.shot('04', 'commit-details'); await t.closeTab(); }
  if (wanted('07')) {
    await t.showGraph();
    await graph.locator('.graph-subject').filter({ hasText: /^feat\(branding\): refresh the extension icon$/ }).first().click(); await sleep(800);
    await t.layout('Commit');
    await t.clickRow('icon.png');
    await t.shot('07', 'image-diff');
    await t.closeTab();
  }
  if (wanted('05') || wanted('06')) {
    await t.showGraph();
    await t.layout('File Tree');
    await t.row('src').click().catch(() => {}); await sleep(800);
    if (wanted('05')) { await t.shot('05', 'file-tree'); }
    if (wanted('06')) {
      await t.row('resources').click(); await sleep(800);
      await t.clickRow('icon.png');
      await t.shot('06', 'image-preview');
      await t.closeTab();
    }
  }
  if (wanted('14') || wanted('15')) { await t.showGraph(); await t.layout('Repositories', 'Changes'); }
  if (wanted('14')) {
    // The file in an editor, the cursor on a line, and the hover of the blame at its end.
    await page.keyboard.press('Control+Alt+Shift+o'); await sleep(1200); await page.keyboard.press('Enter'); await sleep(2500);
    await page.keyboard.press('Control+g'); await sleep(500);
    await page.keyboard.type(option('blame-line') ?? '20'); await page.keyboard.press('Enter'); await sleep(300);
    await page.keyboard.press('End'); await sleep(1800);
    await page.keyboard.press('Meta+k'); await page.keyboard.press('Meta+i'); await sleep(2500);
    await t.shot('14', 'line-blame');
    await page.keyboard.press('Escape');
  }
  if (wanted('15')) {
    // The whole file's blame in the gutter, with the lenses above its functions.
    if (!wanted('14')) { await page.keyboard.press('Control+Alt+Shift+o'); await sleep(1200); await page.keyboard.press('Enter'); await sleep(2500); }
    await page.keyboard.press('Control+Alt+Shift+f'); await sleep(2500);
    await page.keyboard.press('Control+Alt+Shift+l'); await sleep(3000);
    await page.keyboard.press('Control+g'); await sleep(500);
    await page.keyboard.type('1'); await page.keyboard.press('Enter'); await sleep(1500);
    await t.shot('15', 'file-blame');
  }
} finally {
  await closeWindow(stage);
}

if (wanted('12')) {
  const merge = await openWindow(join(work, 'merge', 'git-checkout'), 9412);
  try {
    const t = tools(merge);
    await t.openGitCheckout();
    await t.layout('Changes');
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
  } finally {
    await closeWindow(merge);
  }
}
console.log(`done: ${out}`);
