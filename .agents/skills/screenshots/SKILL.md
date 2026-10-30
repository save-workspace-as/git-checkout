---
name: screenshots
description: Retake the product screenshots in docs/screenshots from a real VS Code window, after the UI changed
---

# Retake the screenshots

Run this when a feature or the look of a view changed and the pictures in `docs/screenshots/` (used by the README and the website) are out of date. It rebuilds the extension, builds clean demo repositories from this repository's history, installs the extension into a fresh VS Code, and captures each shot as the macOS window, with its title bar and traffic lights.

## Run it

```sh
cd .agents/skills/screenshots && npm install      # once: playwright-core
cd ../../.. && node .agents/skills/screenshots/scripts/run.mjs
```

Flags:

- `--only 01,12` retakes just those shots (ids below). Everything else is left as it is.
- `--out <folder>` writes somewhere else (default `docs/screenshots`).
- `--no-package` reuses the extension built last time (`/tmp/gcshots/gitcheckout.vsix`) instead of compiling and packaging it.
- `--author "Name|email"` makes the demo commits by that person. The default is the latest author in the history who is not a bot, so the graph shows their real GitHub picture.
- `--keep-open` leaves the VS Code windows up, for looking at them.

Requirements: macOS with the screen unlocked and awake (a locked screen cannot be captured, and the script stops with a message), `swiftc`, Node 20+, and network for the avatars and the first VS Code download. It opens its own VS Code windows and drives them over DevTools, so no browser is needed; do not touch the keyboard or mouse while it runs, and it takes a few minutes.

## The shots

| id | file | shows |
| --- | --- | --- |
| 01 | `01-commit-graph.png` | The graph with a commit selected, bottom panel drawn down to its tab bar |
| 02 | `02-graph-search.png` | The graph search with a `path:` filter and its matches |
| 03 | `03-stage-and-unstage.png` | The Changes tab, panel maximized |
| 04 | `04-commit-details.png` | A commit's details and files, panel maximized |
| 05 | `05-file-tree.png` | The File Tree tab |
| 06 | `06-image-preview.png` | A picture previewed in the File Tree |
| 07 | `07-image-diff.png` | The old and new icon in a commit's diff |
| 08 | `08-file-history.png` | The History modal of a file with 3 to 4 commits |
| 09 | `09-blame.png` | The Blame modal |
| 10 | `10-quick-launch.png` | Quick Launch over the graph |
| 11 | `11-interactive-rebase.png` | The Interactive Rebase modal, onto `HEAD~4` |
| 12 | `12-merge-conflict.png` | The Merge modal on a conflict, panel hidden |
| 13 | `13-stage-lines.png` | Two selected lines with the Stage and Discard Changes buttons |

A new feature that deserves a picture: add a block to `scripts/run.mjs` after the shot it is most like, with the next free id, and add its row here and to the website's `index.astro`.

## What to check in the result

Open each picture before you hand it over. Look for:

- the title is "Git Checkout — git-checkout" (not "[Extension Development Host]"), and the traffic lights are there;
- no modal is cut off by the bottom panel, and none has an outline around the whole dialog;
- no error toast, no leftover search text, no folder path from `/tmp` in the sidebar (the Worktrees section is folded for that);
- avatars are real GitHub pictures, not initials, and round without a colored edge;
- the shot shows what its row says, and nothing from your own work (the demo repository is a copy, never this one).

## How it is built

- `scripts/demo-repos.sh` makes `/tmp/gcshots/stage/git-checkout` (branches, tags, a stash, uncommitted changes, a flipped icon commit) and `/tmp/gcshots/merge/git-checkout` (a merge with one conflict). The folder must be called `git-checkout`: the window title shows it. The remote is a local copy behind the GitHub address, so nothing is fetched.
- `scripts/run.mjs` installs the `.vsix` into a fresh profile, starts VS Code with a DevTools port, drives it with `playwright-core`, and captures the window with `scripts/window.swift` and `screencapture`.
- Keys that open a modal for a file are bound in the profile's `keybindings.json`, since the commands are not in the Command Palette.

## Guardrails

- Never change this repository's history or working tree to set up a shot: the demo is a clone.
- Do not commit anything unless asked. Report which pictures changed.
- If a shot fails, fix the step in `run.mjs` rather than editing the picture.
