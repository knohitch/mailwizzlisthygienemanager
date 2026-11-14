#!/usr/bin/env sh
# PostgreSQL logical backup script for MailWizz List Hygiene Manager
# Never stores raw credentials in script; reads POSTGRES_* from .env or environment.
set -eu

BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${BACKUP_DIR}/hygiene_db_${TIMESTAMP}.dump"

docker compose exec -T postgres pg_dump \
  -U "${POSTGRES_USER:-hygiene_user}" \
  -d "${POSTGRES_DB:-mailwizz_hygiene}" \
  -F c > "$OUT_FILE"

sha256sum "$OUT_FILE" > "${OUT_FILE}.sha256"
echo "Backup written: $OUT_FILE"
