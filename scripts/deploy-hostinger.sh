#!/usr/bin/env bash
set -euo pipefail

HOST="82.29.194.219"
PORT="65002"
USER="u697417861"
REMOTE_DIR="/home/u697417861/domains/blue-spider-738233.hostingersite.com/nodejs"
REMOTE_REPO="https://github.com/romeokany187/thebestsarl.git"

echo "[deploy] Connecting to Hostinger and updating the app..."
ssh -tt -o StrictHostKeyChecking=accept-new -p "$PORT" "$USER@$HOST" "
set -e
mkdir -p '$REMOTE_DIR'
cd '$REMOTE_DIR'

if [ ! -d .git ]; then
  echo '[remote] No Git repository found, initializing it now...'
  git init
fi

git remote remove origin >/dev/null 2>&1 || true
git remote add origin '$REMOTE_REPO'
git fetch origin main

echo '[remote] Cleaning leftover files before checkout...'
git clean -fd || true

git checkout -B main origin/main
git reset --hard origin/main
git clean -fd

echo '[remote] Installing dependencies...'
npm install

echo '[remote] Building production app...'
PRISMA_SCHEMA_FILE=prisma/schema.mysql.prisma npm run build
"

echo ""
echo "[deploy] Done. If needed, restart the app from Hostinger or your process manager."
