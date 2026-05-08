#!/usr/bin/env bash
# Sync local report/ tree to Overleaf via clone, copy, commit, push.
#
# Usage:
#   scripts/sync-overleaf.sh "commit message"
#
# Requires OVERLEAF_TOKEN and OVERLEAF_PROJECT_ID in .env.local at repo root.
# Overleaf blocks git force-push and doesn't play nicely with git-subtree, so
# we keep local as the edit surface and sync forward with a normal push from
# a throwaway clone.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ $# -lt 1 ]; then
  echo "usage: $0 \"commit message\"" >&2
  exit 1
fi
MSG="$1"

if [ ! -f .env.local ]; then
  echo "error: .env.local not found at $ROOT" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1091
source .env.local
set +a
: "${OVERLEAF_TOKEN:?missing OVERLEAF_TOKEN in .env.local}"
: "${OVERLEAF_PROJECT_ID:?missing OVERLEAF_PROJECT_ID in .env.local}"

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

REMOTE_URL="https://git:${OVERLEAF_TOKEN}@git.overleaf.com/${OVERLEAF_PROJECT_ID}"

echo "[sync] cloning overleaf..."
git clone --quiet "$REMOTE_URL" "$TMPDIR/ov" 2>&1 | sed "s|${OVERLEAF_TOKEN}|***|g"

echo "[sync] mirroring local report/ over tracked files..."
cd "$TMPDIR/ov"
while IFS= read -r f; do
  src="$ROOT/report/$f"
  if [ -f "$src" ]; then
    cp "$src" "$f"
  fi
done < <(git ls-files)

# Also copy any LOCAL files Overleaf doesn't know about yet (new figures,
# new chapters, new bib entries the asset side, etc.). Excludes drafts/
# (gitignored), feedback/ (audio + transcripts kept local), papers/
# (external materials linked separately), and LaTeX intermediates.
echo "[sync] checking for new local files to add..."
(cd "$ROOT/report" && find . -type f \
  ! -path "./drafts/*" \
  ! -path "./feedback/*" \
  ! -path "./papers/*" \
  ! -path "./.review/*" \
  ! -name "finalReport-all.txt" \
  ! -name "finalReport-body.txt" \
  ! -name "the flow.txt" \
  ! -name "scan of chapter 2.txt" \
  ! -name "*.aux" ! -name "*.log" ! -name "*.bbl" ! -name "*.blg" \
  ! -name "*.toc" ! -name "*.out" ! -name "*.fls" ! -name "*.fdb_latexmk" \
  ! -name "~\$*") | while IFS= read -r f; do
  if [ ! -e "$TMPDIR/ov/$f" ]; then
    mkdir -p "$TMPDIR/ov/$(dirname "$f")"
    cp "$ROOT/report/$f" "$TMPDIR/ov/$f"
  fi
done

git add -A
if git diff --cached --quiet; then
  echo "[sync] no changes. overleaf is already up to date."
  exit 0
fi

echo "[sync] files changed:"
git diff --cached --stat | sed 's/^/  /'

git commit -m "$MSG"
echo "[sync] pushing..."
git push origin master 2>&1 | sed "s|${OVERLEAF_TOKEN}|***|g"

echo "[sync] done."
