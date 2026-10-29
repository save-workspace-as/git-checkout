# Project Guidelines

Agents and humans follow this file.

## Working style

1. **Accuracy over speed** — Confirm APIs, types, and file paths in this repo before using them; do not invent VS Code or `vscode.git` members.
2. **Tests for behavior** — Any change to runtime logic (parsing, git orchestration, protocol mapping, webview message handling) needs **automated tests** in the same PR unless the issue explicitly waives them. UI-only copy or config defaults may skip tests when there is nothing meaningful to assert.
3. **Fixing over disabling** — Fix root causes; do not weaken types, skip tests, or delete assertions to make CI green.
4. **Minimal scope** — One issue per PR; no drive-by refactors or unrelated formatting.
5. **Native UI, no custom controls** — Stay as close to VS Code's own UI as possible. Use what VS Code provides (commands, `webview/context` menus via `data-vscode-context`, `editor/title` and view actions, Quick Pick, input boxes, notifications, tree views, codicons, `--vscode-*` theme colours) instead of building it in the webview. Do not hand-roll context menus, dropdowns, dialogs, or toolbars. Custom webview UI is only for what VS Code has no surface for (the commit graph and its search field, diffs); style it with `--vscode-*` variables (for example `--vscode-input-*` for text fields), and if you add one, say in the PR why no native option fits. Form controls inside webviews are VS Code Elements (`@vscode-elements/elements`), not hand-styled HTML; see [webview/AGENTS.md](webview/AGENTS.md).
6. **Native text** — Webview text inherits VS Code's font: `--vscode-font-family`, `--vscode-font-size`, and `--vscode-font-weight` for UI, and the `--vscode-editor-font-*` variables for code and diffs. Do not set custom `font-size`, `font-weight` (headings may use 600), `line-height`, `text-transform`, or `letter-spacing`, and do not add custom font stacks. Use `--vscode-*` colour variables (for example `descriptionForeground` for secondary text) instead of hard-coded colours.
7. **Before finishing** — Run the `deslop` skill ([.agents/skills/deslop/SKILL.md](.agents/skills/deslop/SKILL.md)) on your diff.

## Source layout

Group code by what it is for, not by file type. A new file goes in the folder of the feature it belongs to, with its tests beside it.

| Folder | What lives there |
|--------|------------------|
| `src/core/` | Git plumbing with no feature of its own: the `git` CLI wrapper and its queue, the `vscode.git` bridge, watchers, settings, shared parsers, and test support in `core/testing/`. |
| `src/features/<name>/` | One folder per feature (`graph`, `changes`, `history`, `branches`, `sync`, `stash`, `worktrees`, `submodules`, `rebase`, `conflicts`, `bisect`, `gitflow`, `signing`, `operations`). It holds the feature's services, parsers, form hosts and a `*Controller` that owns the feature's behavior for one window. |
| `src/panel/` | The Git Checkout window: `GitCheckoutPanelManager` (wiring, the message router, thin delegates), the window hub, the bottom views, and the shared modal-form infrastructure. |
| `src/ui/` | Native views: the sidebar, the repository menu, the status bar. |
| `src/extensibility/` | Quick Launch, custom commands, external tools, `.gitignore` helpers. |
| `src/shared/<group>/` | Types and pure code used by both the extension and the webviews: protocols, models, helpers. It must not import `vscode` or anything outside `src/shared/`. `protocol.ts` joins the groups. |
| `webview/` | Code that runs in the browser. It imports only `webview/` and `src/shared/`. Its tests sit beside it (`webview/**/*.test.ts`) and run on a real DOM. |

A feature controller takes its window as a typed `Pick<GitCheckoutPanelManager, ...>`, so what it needs from the window is explicit. `src/layering.test.ts` enforces the import rules above.

## Consistency

The same thing looks and sits the same everywhere. Before adding UI, find the existing control that does the same job and reuse it; do not restyle a copy.

- **Icons:** use codicons only, never hand-drawn SVG paths. Each action has one icon, listed in [src/shared/app/actionIcons.ts](src/shared/app/actionIcons.ts), and every place that offers the action uses it: command `icon` in `package.json` (`$(name)`), and webviews through `codicon()` in [webview/codicon.ts](webview/codicon.ts). A new action gets a new entry with an icon no other action uses, and `src/shared/app/actionIcons.test.ts` maps each iconed command to its action. File and folder rows show the user's file icon theme; the codicon `file` and `folder` are only the fallback.
- **Icon placement:** an icon button sits at the end of its row or toolbar, in the same order everywhere: row actions (stage, unstage, discard) before open, then the status badge. Icon buttons are 16px glyphs, hidden with `visibility` rather than removed so nothing shifts on hover or selection. Toolbars right-align their buttons and toggle with `aria-pressed`.
- **Spacing:** reuse the shared values instead of new ones: modal header `12px 14px`, modal body `12px 14px 18px`, row gap `9px`, and in operation forms 30px between fields and 9px between a field's label and its control, as in the VS Code Settings editor (`settingsEditor2.css`), control gap `0.5em`, control padding and minimum heights from the modal rules below. Do not add one-off paddings or margins to match a single screen.
- **Wording:** labels, placeholders and buttons are sentence case ("Test connection"); titles name the action ("Create Tag"); a submit button repeats its title's verb, never "Submit". Every operation form has a one-line description.
- **Diff options:** every diff view in the bottom panel (Commit's Changes, Changes' Diff and Tree's Preview) has its options as buttons in the native view header, from the `gitCheckout.diff.*` commands in `view/title`; a button that switches something on uses `toggled` so it shows highlighted while on. The History modal has no native header, so it uses the shared toolbar from [webview/details/diffToolbar.ts](webview/details/diffToolbar.ts) with the same icons, labels and order. Do not add another in-webview toolbar for a view that has a header.
- **Same job, same control:** the same option in different views (for example the diff options in the bottom panel headers and in the History modal) has the same icon, label, order and toggle behaviour.

## Localization and wording

- **Every string a person can read goes through `l10n.t()`**: `import * as l10n from '@vscode/l10n'` in the extension and in webviews, always written as `l10n.t('...', args)` with a literal first argument, never a destructured `t`, which the extractor cannot see. Use placeholders (`{0}`), not concatenation or template literals, so translators get the whole sentence. Webviews get the translations from the extension through `data-l10n` on `<body>`, and each webview entry imports `installL10n` first.
- **Contributions in `package.json`** (command titles and categories, view and container names, submenu labels, setting descriptions) are `%key%` entries in `package.nls.json`, never literals.
- **Run `npm run l10n:export`** after adding or changing a string and commit `l10n/bundle.l10n.json`. `src/localization.test.ts` fails when the bundle is stale, a contribution is a literal, an nls entry is unused, or code has user-facing text outside `l10n.t()`. Text for developers or the language model (internal errors, the commit-message prompt) is the only exception; it is listed in that test.
- **Wording:** American English ("canceled", "color", "behavior"). Follow VS Code: sentence case for messages, descriptions and placeholders; Title Case for command, menu and dialog titles; "Checkout" and "Checkout" as a verb ("Checkout" only as a noun); "Git" capitalized in prose; "Source Control" (not "SCM"), "working tree", "terminal"; a single "…" (not "...") for ongoing work or menu items that need more input; no contractions in errors ("Could not", not "Couldn't"); describe what happened and what to do next; do not name other products.
- **Git terms:** use the words the Git documentation uses ([git-commit](https://git-scm.com/docs/git-commit), [gitglossary](https://git-scm.com/docs/gitglossary)) and use each one the same way everywhere: *commit message* with a *subject* and a *body* (not "description"), *hash* (not "SHA"), *upstream branch* for what a branch tracks and *remote-tracking branch* for `origin/main`, *working tree* and *index*, *stash entry* with *apply*, *pop* and *drop* (not "delete"), *detached HEAD*, *fast-forward*, *worktree*, *lightweight* and *annotated* tags. VS Code's own words win for its surfaces: *folder* (not "directory"), *repository* (not "repo"). Name a system action the way that system does: "Reveal in Finder" on macOS, "Reveal in File Explorer" on Windows, "Open Containing Folder" on Linux (see `src/shared/app/platformCommands.ts`).
- **Menu items:** a menu item that opens a form or asks for choices ends with "…" and one that acts at once does not; items that create something start with "New" ("New Branch…"), and the form they open is titled "Create Branch". The same action has the same label in every menu, button and Quick Launch.

## Webview UI and UX

Everything about `webview/`: which VS Code Element to use for each job, how a view is written (Lit template over state), forms, modals (Enter and Escape), styling, icons and accessibility, is in [webview/AGENTS.md](webview/AGENTS.md). It is self-contained and wins over habit; read it before touching a webview or `webview/styles.css`. Cross-cutting rules (native-first, consistency, wording, localization) stay here.

## Tests

- **Approach top to bottom:** For a user-visible feature or fix (a command, tree action, panel flow), first add or extend one e2e test that drives it the way a user would and asserts the outcome (git state, tree contents, open panel). It gives the most confidence that the feature works. Then go down the pyramid only where the e2e test falls short: integration tests when real git output matters, unit tests for edge cases e2e cannot reach cheaply (malformed output, empty or null inputs, every branch of a parser) and to pinpoint failures. Pure internal logic with no user-visible path starts at the unit level.
- **Runner:** `npm run test:unit`, `npm run test:integration` (real git), and `npm run test:e2e` (real VS Code) run each kind on its own. Unit and integration use Node.js built-in `node:test` with TypeScript via `tsx`. CI runs `unit` and `integration` as separate jobs on Node.js 20 and 22, and `e2e` on Node.js 22. The `build` job lints and packages the VSIX and does not run tests. Node.js 20's test runner does not expand glob patterns, so the unit and integration scripts pass an explicit file list ([src/dev/runNodeTests.ts](src/dev/runNodeTests.ts)). Integration tests require **`git` on `PATH`** (GitHub-hosted runners include it).
- **Running one test:** pass file filters (substrings of the path) after `--`, plus optional runner flags: `npm run test:unit -- worktreeService`, `npm run test:unit -- sidebarManifest --test-name-pattern "worktrees"`, `npm run test:integration -- submodule`, `npm run test:e2e -- reflog --label stable --grep "Exit"`. E2E filters match files in [e2e/](e2e/); `--label stable|minimum` picks one VS Code version and `--grep` filters test names. Several filters can be combined, and an unmatched filter fails the run.
- **File names:** `<subject>.<kind>.test.ts`, where the kind says what the test needs so each kind can be run on its own by glob. Unit tests omit the kind: `gitRefParser.test.ts`. Real-git tests use `.integration`: `workingTreeService.integration.test.ts`. VS Code tests use `.e2e`: `e2e/sidebar.e2e.test.ts`. Do not mix kinds in one file; split it instead.
- **Location:** Colocate unit and integration tests next to the module under test (for example `src/core/gitRefParser.test.ts` beside `gitRefParser.ts`); e2e tests live in [e2e/](e2e/).
- **Unit tests:** Most numerous and fastest. Pure functions and parsers first; services with injectable dependencies next. Mock `GitCli`, `GitExtensionService`, and registries via [src/core/testing/serviceTestUtils.ts](src/core/testing/serviceTestUtils.ts). Prefer table-driven cases and edge inputs (empty string, malformed git output, null upstream).
- **Git integration tests:** When behavior depends on real Git output or repository state (format strings, `merge-tree`, `for-each-ref`, merge conflicts, `diff --diff-filter=U`), add cases that run **`git` in a temporary repo** instead of only faking stdout. Use [src/core/testing/gitRepoHarness.ts](src/core/testing/gitRepoHarness.ts) (`initTempRepository`, `runGit`, shared test identity) and wire services with `mockCliRegistry` / `mockGitExtensionService` so production code still goes through `GitCli`. Put new real-git cases in [src/core/git.integration.test.ts](src/core/git.integration.test.ts) unless a single module owns the scenario (then add `<module>.integration.test.ts` beside it). Always `cleanup()` the temp repo in `finally`. For ordering by committer time, set **both** author and committer dates (see `commitEmptyAt` in the harness).
- **What not to test:** Trivial one-liners, generated files, or `dist/` / `media/webview/*.js`.
- **VS Code / webview:** Prefer extracting logic into `src/core/`, a feature folder under `src/features/`, `src/shared/`, or a `vscode`-free `src/ui/*Model.ts` and unit-testing it there.
- **E2E tests:** Behavior that only exists inside VS Code (activation, registered commands and views, tree contents, commands changing repo state) goes in [e2e/](e2e/), run with `npm run test:e2e` (mocha via `@vscode/test-cli`, config in [.vscode-test.mjs](.vscode-test.mjs)). Each test opens its own temp git repo (`openFreshFixture` in `beforeEach`) and the suite runs against VS Code stable and the minimum engine (`--label stable|minimum`). Keep the suite small: drive commands with node arguments instead of prompts, and assert git state with `git`. Close other VS Code windows of the same version before running locally. If an issue is inherently visual (layout, drag-and-drop gestures), state in the PR why automated tests were not added.
- **Gate:** Run `npm run lint`, `npm run compile`, `npm run test:unit`, and `npm run test:integration` locally and require each to exit 0 before opening or updating a pull request. Also run `npm run test:e2e` when the change touches an e2e-covered flow. Push only after those local commands have passed.

## Build and verify

- Run `npm run lint` (typechecks the extension and webview), `npm run compile`, `npm run test:unit`, and `npm run test:integration` locally after code changes and before pushing. CI's `build` job runs lint and `npm run package`. The test jobs are described under Tests.
- `dist/` and everything `npm run compile` writes to `media/webview/` (scripts, `styles.css`, the codicon font and stylesheet) are build outputs; do not edit or commit them.
- To try the extension, use Run Without Debugging (`Cmd/Ctrl+F5`); F5 with the debugger attached can hang the extension host.

## Logging

- Log through `createLogger('<component>')` from [src/log.ts](src/log.ts), one module-level `const log` per file; never use `console.*` or create another output channel.
- Log every caught runtime error, including expected probes and recovered fallbacks, at an appropriate level. For intentionally ignored expected outcomes, add a code comment explaining the condition; do not silently discard the caught error.
- Pick the level by audience: `error` for failures the user hits, `warn` for recovered failures and fallbacks (for example `vscode.git` API failing before the CLI retry), `info` for user-initiated operations, `debug` for per-command and per-refresh detail, `trace` for payloads.
- Pass the original caught error as a trailing argument (`log.warn('push failed; falling back to CLI', error)`) so the stack and structured details are kept; do not stringify errors into the message or log only a derived message.
- Never leave a `catch` empty or silently ignore an error. Expected probes (for example `show-ref` to test whether a branch exists) must have a code comment and log the caught error at `debug` unless the failure is represented by an explicit result type.
- Never log secrets, tokens, credentials, or commit message and file contents.
- Verbosity is controlled by the VS Code log level on the Git Checkout channel, not by extension settings.

## Commit messages

- Use Conventional Commit format for commit messages and pull request titles you create: `type(scope)!: subject`.
- Use standard types such as `feat`, `fix`, `docs`, `refactor`, and `chore`; include `!` for breaking changes.
- Keep pull request titles Conventional Commit compliant because squash merges should use the PR title and Release Please reads the resulting commit on `main`.

## Canonical examples

| Task | Example |
|------|---------|
| Parser unit tests | [src/core/gitRefParser.test.ts](src/core/gitRefParser.test.ts), [src/core/gitLogParser.test.ts](src/core/gitLogParser.test.ts) |
| Service with mock `GitCli` | [src/features/branches/mergePreflight.test.ts](src/features/branches/mergePreflight.test.ts), [src/features/branches/integrationService.test.ts](src/features/branches/integrationService.test.ts) |
| Test doubles | [src/core/testing/serviceTestUtils.ts](src/core/testing/serviceTestUtils.ts) |
| Real-git temp repo | [src/core/testing/gitRepoHarness.ts](src/core/testing/gitRepoHarness.ts), [src/core/git.integration.test.ts](src/core/git.integration.test.ts) |
| E2E in VS Code | [e2e/sidebar.e2e.test.ts](e2e/sidebar.e2e.test.ts) |
| Git parsing | [src/core/gitRefParser.ts](src/core/gitRefParser.ts) |
| Logger | [src/log.ts](src/log.ts) |
