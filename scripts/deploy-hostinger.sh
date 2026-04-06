#!/usr/bin/env bash
set -euo pipefail

HOST="82.29.194.219"
PORT="65002"
USER="u697417861"
REMOTE_DIR="~/domains/blue-spider-738233.hostingersite.com/nodejs"
REMOTE_CMD='cd ~/domains/blue-spider-738233.hostingersite.com/nodejs && git pull origin main && npm install && PRISMA_SCHEMA_FILE=prisma/schema.mysql.prisma npm run build'

echo "[deploy] Connecting to Hostinger and updating the app..."
ssh -tt -o StrictHostKeyChecking=accept-new -p "$PORT" "$USER@$HOST" "$REMOTE_CMD"

echo ""
echo "[deploy] Done. If needed, restart the app from Hostinger or your process manager."
