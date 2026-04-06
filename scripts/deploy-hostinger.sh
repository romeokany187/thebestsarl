#!/usr/bin/env bash
set -euo pipefail

BRANCH="$(git branch --show-current)"

if [[ "$BRANCH" != "main" ]]; then
  echo "[deploy] Switch to the 'main' branch before deploying to Hostinger."
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "[deploy] There are uncommitted changes. Commit them first, then rerun this command."
  exit 1
fi

echo "[deploy] Pushing '$BRANCH' to GitHub..."
git push origin "$BRANCH"

echo "[deploy] GitHub Actions will now deploy automatically to Hostinger."
echo "[deploy] Check the Actions tab on GitHub for live progress if needed."
