# Demo video: storyboard

About 60 seconds, no narration, a line of text per scene is for whoever edits it. The script is `node scripts/run.mjs --video`;
each scene below is one `scene()` call in `scripts/tour.mjs`.

| # | Scene | What happens on screen | Hold |
|---|-------|------------------------|------|
| 1 | The graph | Git Checkout opens: the graph with avatars, branch and tag labels; Repositories in the sidebar | 4 s |
| 2 | Look into a commit | Pick a commit; the Commit section lists its files; pick one and its diff opens as a tab; close it | 6 s |
| 3 | Search | Type `path:<folder>` in the graph search; the graph narrows to the matches; clear it | 5 s |
| 4 | Stage | Open Changes, pick the unstaged file; its diff opens; select two lines (Stage / Discard appear); close | 7 s |
| 5 | Quick Launch | Cmd+P over the graph shows every action | 4 s |
| 6 | File history and blame | The History modal of a file, then its Blame modal | 8 s |
| 7 | Blame in the editor | Open the file; blame at the end of the line with its hover; then blame for every line and the CodeLens | 8 s |
| 8 | Interactive rebase | The rebase modal onto `HEAD~4` with the commits listed; Escape | 5 s |

Not shown on purpose: Pull Requests (needs a GitHub sign-in) and the merge editor (needs a second window).
