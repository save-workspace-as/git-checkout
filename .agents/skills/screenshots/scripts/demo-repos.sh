#!/bin/sh
# Builds the repositories the screenshots are taken in, from a copy of this repository's history:
#   <work>/stage/git-checkout  main, feature branches, tags, a stash, uncommitted changes and a new icon
#   <work>/merge/git-checkout  the same, in the middle of a merge with one conflict
# Usage: demo-repos.sh <source repository> <work folder> <author name> <author email>
# The folders are called `git-checkout` because the window title shows the folder name.
set -e
SOURCE="$1"; WORK="$2"; NAME="$3"; EMAIL="$4"
rm -rf "$WORK/stage" "$WORK/merge" "$WORK/origin.git"
mkdir -p "$WORK/stage" "$WORK/merge"

git clone -q --no-hardlinks "$SOURCE" "$WORK/stage/git-checkout"
cd "$WORK/stage/git-checkout"
git config user.name "$NAME"; git config user.email "$EMAIL"
git checkout -q -B main origin/main 2>/dev/null || git checkout -q main
# Only `main` is remote: no local-only or foreign branches show in the graph.
for ref in $(git for-each-ref --format='%(refname)' refs/remotes/origin | grep -v 'refs/remotes/origin/main$\|refs/remotes/origin/HEAD$'); do git update-ref -d "$ref"; done
git config remote.origin.fetch '+refs/heads/main:refs/remotes/origin/main'
git branch feat/merge-modal HEAD~2 2>/dev/null || true
git branch feat/line-staging HEAD~5 2>/dev/null || true
git branch fix/folder-labels HEAD~9 2>/dev/null || true
git branch docs/screenshots HEAD~12 2>/dev/null || true

# A flipped icon, so the image diff and the preview have a picture that changed.
sips -f horizontal resources/icon.png >/dev/null 2>&1 || true
git add resources/icon.png
git commit -q -m "feat(branding): refresh the extension icon"

# Uncommitted work and a stash.
printf '\nRun `npm run test:unit` before you push.\n' >> CONTRIBUTING.md
git stash push -q -m "WIP: contributing notes"
printf '\nRun `npm run test:unit` before you push.\n' >> CONTRIBUTING.md
git add CONTRIBUTING.md
printf '# Notes\n\nIdeas for the next release.\n' > docs-notes.md
FILE=$(git ls-files 'src/shared/changes/*.ts' | grep -v test | head -1)
python3 - "$FILE" <<'PY'
import sys
p = sys.argv[1]
lines = open(p).read().split('\n')
for i in range(len(lines) // 2, len(lines)):
    if lines[i].strip() and not lines[i].strip().startswith(('/', '*')):
        lines[i] = lines[i] + ' // reviewed'
        break
open(p, 'w').write('\n'.join(lines))
PY

# The remote is the real GitHub address, so issue links and the avatars resolve; auto-fetch is off, so nothing else uses the network.
git clone -q --bare "$WORK/stage/git-checkout" "$WORK/origin.git"
git remote set-url origin "https://github.com/save-workspace-as/git-checkout.git"

# The merge repository: two branches that change the same lines of a file differently, merged.
git clone -q --no-hardlinks "$WORK/stage/git-checkout" "$WORK/merge/git-checkout" 2>/dev/null
cd "$WORK/merge/git-checkout"
git config user.name "$NAME"; git config user.email "$EMAIL"
git checkout -q main
git reset -q --hard HEAD~1
git remote set-url origin "https://github.com/save-workspace-as/git-checkout.git"
for ref in $(git for-each-ref --format='%(refname)' refs/remotes/origin | grep -v 'refs/remotes/origin/main$\|refs/remotes/origin/HEAD$'); do git update-ref -d "$ref"; done
FILE=$(git ls-files 'src/shared/changes/*.ts' | grep -v test | head -1)
edit() { python3 - "$FILE" "$1" <<'PY'
import sys
p, tag = sys.argv[1], sys.argv[2]
lines = open(p).read().split('\n')
body = [i for i, l in enumerate(lines) if l.strip() and not l.strip().startswith(('/', '*', 'import', '}', '{'))]
at = body[len(body) // 2]
lines[at] = lines[at] + ' // ' + tag
lines[at + 1] = lines[at + 1] + ' // ' + tag
open(p, 'w').write('\n'.join(lines))
PY
}
git checkout -q -b feat/folder-slash
edit "shows the folder with a slash"
git commit -qam "feat(changes): show the folder of a file with a trailing slash"
git checkout -q main
edit "keeps a renamed file out of the check"
git commit -qam "fix(changes): keep a renamed file out of the untracked check"
git merge feat/folder-slash --no-commit >/dev/null 2>&1 || true
echo "demo repositories ready in $WORK"
