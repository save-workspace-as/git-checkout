# Contributing

## Human pull requests

Follow [AGENTS.md](AGENTS.md) for code style, logging, tests, and commits. Run `npm run lint`, `npm run compile`, and `npm test` before you push (`npm test` needs the `git` CLI; see the **Tests** section in AGENTS.md for unit vs real-git integration tests).

## Continuous integration

Protect `main` with the CI checks that should block merge. `build` lints and packages the VSIX. `unit` and `integration` run on Node.js 20 and 22 (the documented minimum and the version this repo already uses in CI). `e2e` runs on Node.js 22 under Xvfb (GitHub’s Ubuntu image has no display), reuses a cached VS Code download under `.vscode-test`, retries when that download or the VS Code window fails to start, and uploads `e2e-attempt-*.log` after a failed run. No extra secrets are required.

## Developing the extension

### Prerequisites

- Node.js 20+
- VS Code 1.90 or newer
- Built-in **Git** extension enabled (`vscode.git`)

### Build

```bash
npm install
npm run compile
```

This produces:

- `dist/extension.js` — extension host (Node)
- `media/webview/main.js` — webview bundle (browser)

### Run locally

1. Open this repository in VS Code.
2. Press **F5** (configuration **Run Extension**).
3. In the Extension Development Host window:
   - Run **Git Checkout: Show Output** from the Command Palette, or open **Output** → channel **Git Checkout**.
   - Run **Developer: Show Running Extensions** and confirm **Git Checkout** (`rkonit.gitcheckout`) is listed as a **workspace** extension.
   - With the Git Checkout panel focused: **Ctrl+P** (**Cmd+P** on macOS) Quick Launch and **Ctrl+Shift+Alt+`** open the repository in a terminal.

> **Debugger not attaching?** If VS Code shows "Extension host did not start in 10 seconds" and **Show Running Extensions** stays empty, the host is stuck waiting for the debugger to attach. Use **Run > Run Without Debugging** (or `Cmd/Ctrl+F5`) instead of **F5** — the extension activates normally without an attached debugger.

### Run on Remote (WSL, SSH, Dev Container)

Git Checkout must run on the **workspace** extension host (same machine as your repo), not only on your local UI host.

1. Connect with Remote - WSL, Remote - SSH, or Dev Containers.
2. Open **this extension’s source folder on the remote** (clone or open `git-checkout` there).
3. On the remote terminal: `npm install` and `npm run compile`.
4. Press **F5** from that remote window.
5. Use **Developer: Show Running Extensions** in the Extension Development Host and confirm **Git Checkout** runs on the **remote** host when your workspace is remote.

Do not set `git.enabled` to false; this extension depends on the built-in Git extension for credentials and `git.path`.

#### Fixture and large-repo checks

`npm run test:integration` builds temporary repositories and checks:

- content merge, modify/delete, and add/add conflicts
- interactive rebase stopped on a conflict
- a submodule checkout and a linked worktree
- a committed Git LFS pointer file (no `git-lfs` binary required)
- reftable, when `git init --ref-format=reftable` works
- a history longer than one graph page (`git log` is limited to 80 commits; the graph virtualizes rows)

Writes for one repository go through a single queue, so Git Checkout mutations do not overlap. If the built-in Git extension holds `index.lock` or `shallow.lock`, the error is reported as a lock instead of a second overlapping write.

Manual pass on local, then on WSL or a Dev Container, and on SSH when you have a host:

1. Running Extensions and `git.path`, as above.
2. Stage a hunk, commit, and push.
3. Start an interactive rebase that conflicts, then continue or abort.
4. Update a submodule and open a linked worktree.
5. Open a long history, scroll the graph, and confirm the UI stays responsive while older commits load a page at a time.

When a check fails, compare **Git Checkout: Show Output** with `git status` in **Git Checkout: Open Repo Terminal** (same host as the repository).

### Scripts

| Script | Description |
|--------|-------------|
| `npm run compile` | Build extension + webview once |
| `npm run watch:extension` | Watch `src/` |
| `npm run watch:webview` | Watch `webview/` |
| `npm run lint` | Typecheck extension and webview |
