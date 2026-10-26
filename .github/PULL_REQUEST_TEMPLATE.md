## What and why

<!-- One issue per pull request. Link it: Fixes #123 -->

## How it was tested

<!-- The e2e test that drives it, plus unit or integration tests where they add something. -->

## Checklist

- [ ] `npm run lint`, `npm run compile`, `npm run test:unit` and `npm run test:integration` pass
- [ ] `npm run test:e2e` passes, if a user-visible flow changed
- [ ] New or changed user-facing strings use `l10n.t()`, and `npm run l10n:export` was run
- [ ] Webview changes follow [webview/AGENTS.md](../webview/AGENTS.md): an Element for every control, a template over state
- [ ] The title is a Conventional Commit, such as `fix(graph): keep the selection after paging`
