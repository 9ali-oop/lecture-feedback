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
SCRUB="sed s|${OVERLEAF_TOKEN}|***|g"

echo "[sync] cloning overleaf..."
git clone --quiet "$REMOTE_URL" "$TMPDIR/ov" 2>&1 | eval "$SCRUB"

echo "[sync] mirroring local report/ over tracked files..."
cd "$TMPDIR/ov"
while IFS= read -r f; do
  src="$ROOT/report/$f"
  if [ -f "$src" ]; then
    cp "$src" "$f"
  fi
done < <(git ls-files)

git add -A
if git diff --cached --quiet; then
  echo "[sync] no changes. overleaf is already up to date."
  exit 0
fi

echo "[sync] files changed:"
git diff --cached --stat | sed 's/^/  /'

git commit -m "$MSG"
echo "[sync] pushing..."
git push origin master 2>&1 | eval "$SCRUB"

echo "[sync] done."
