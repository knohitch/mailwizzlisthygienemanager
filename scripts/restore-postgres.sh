#!/usr/bin/env sh
# PostgreSQL restore script for MailWizz List Hygiene Manager
set -eu

DUMP_FILE="${1:-}"
if [ -z "$DUMP_FILE" ] || [ ! -f "$DUMP_FILE" ]; then
  echo "Usage: $0 <path-to-hygiene_db_timestamp.dump>" >&2
  exit 1
fi

if [ -f "${DUMP_FILE}.sha256" ]; then
  sha256sum -c "${DUMP_FILE}.sha256"
fi

docker compose exec -T postgres pg_restore \
  -U "${POSTGRES_USER:-hygiene_user}" \
  -d "${POSTGRES_DB:-mailwizz_hygiene}" \
  --clean --if-exists < "$DUMP_FILE"

echo "Restore complete from: $DUMP_FILE"
