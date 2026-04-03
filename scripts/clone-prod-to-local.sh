#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROD_ENV_FILE="${ROOT_DIR}/.env.production"
LOCAL_ENV_FILE="${ROOT_DIR}/.env.local"
MODE="${1:-clone}"

read_var_from_file() {
  local file="$1"
  local name="$2"
  python3 - "$file" "$name" <<'PY'
import pathlib
import re
import sys

file_path = pathlib.Path(sys.argv[1])
name = sys.argv[2]
if not file_path.exists():
    sys.exit(1)
text = file_path.read_text()
match = re.search(rf'^{re.escape(name)}=(.*)$', text, re.MULTILINE)
if not match:
    sys.exit(1)
value = match.group(1).strip()
if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
    value = value[1:-1]
print(value)
PY
}

sanitize_pg_url() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

raw = sys.argv[1]
parsed = urlparse(raw)
query = [(k, v) for k, v in parse_qsl(parsed.query, keep_blank_values=True) if k.lower() != 'schema']
clean = parsed._replace(query=urlencode(query))
print(urlunparse(clean))
PY
}

PROD_DATABASE_URL="${PROD_DATABASE_URL:-$(read_var_from_file "$PROD_ENV_FILE" DATABASE_URL)}"
LOCAL_DATABASE_URL="${LOCAL_DATABASE_URL:-$(read_var_from_file "$LOCAL_ENV_FILE" DATABASE_URL)}"

PROD_DATABASE_URL="$(sanitize_pg_url "$PROD_DATABASE_URL")"
LOCAL_DATABASE_URL="$(sanitize_pg_url "$LOCAL_DATABASE_URL")"

check_connection() {
  local label="$1"
  local url="$2"
  echo "[check] ${label}"
  psql "$url" -c "select current_database() as db, current_user as username;"
}

if [[ "$MODE" == "check" ]]; then
  check_connection "local" "$LOCAL_DATABASE_URL"
  check_connection "production" "$PROD_DATABASE_URL"
  exit 0
fi

echo "[clone] Checking local target database"
psql "$LOCAL_DATABASE_URL" -c "select current_database() as db, current_user as username;"

echo "[clone] Starting production dump -> local restore"
pg_dump \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  "$PROD_DATABASE_URL" | psql "$LOCAL_DATABASE_URL"

echo "[clone] Done: production data copied into local database"
