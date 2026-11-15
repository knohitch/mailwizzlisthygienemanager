#!/usr/bin/env sh
# Encrypted PostgreSQL logical backup script for MailWizz List Hygiene Manager
# Never stores raw credentials or plaintext subscriber dumps on disk.
set -eu
umask 077

load_env_var() {
  var_name="$1"
  eval "current_val=\${${var_name}:-}"
  if [ -z "$current_val" ] && [ -f .env ]; then
    line="$(grep -E "^${var_name}=" .env | tail -n 1 || true)"
    if [ -n "$line" ]; then
      val="${line#*=}"
      val="${val%\"}"
      val="${val#\"}"
      val="${val%\'}"
      val="${val#\'}"
      export "${var_name}=${val}"
    fi
  fi
}

load_env_var "BACKUP_DIR"
load_env_var "BACKUP_RETENTION_DAYS"
load_env_var "BACKUP_ENCRYPTION_KEY"
load_env_var "APP_ENCRYPTION_KEY"
load_env_var "POSTGRES_USER"
load_env_var "POSTGRES_DB"

if ! command -v openssl >/dev/null 2>&1; then
  echo "Error: openssl is required to encrypt database backups." >&2
  exit 1
fi

BACKUP_ENC_KEY="${BACKUP_ENCRYPTION_KEY:-${APP_ENCRYPTION_KEY:-}}"
if [ -z "$BACKUP_ENC_KEY" ] || [ "${#BACKUP_ENC_KEY}" -lt 32 ]; then
  echo "Error: BACKUP_ENCRYPTION_KEY or APP_ENCRYPTION_KEY (>=32 chars) must be set." >&2
  exit 1
fi
export BACKUP_ENC_KEY

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${BACKUP_DIR}/hygiene_db_${TIMESTAMP}.dump.enc"

# Stream pg_dump directly into AES-256-CBC PBKDF2 so no plaintext dump touches disk.
docker compose exec -T postgres pg_dump \
  -U "${POSTGRES_USER:-hygiene_user}" \
  -d "${POSTGRES_DB:-mailwizz_hygiene}" \
  -F c </dev/null | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_ENC_KEY -out "$OUT_FILE"

if [ ! -s "$OUT_FILE" ]; then
  rm -f "$OUT_FILE"
  echo "Error: Encrypted backup file is empty." >&2
  exit 1
fi

sha256sum "$OUT_FILE" > "${OUT_FILE}.sha256"

# Enforce retention and securely shred expired dumps/checksums.
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'hygiene_db_*.dump*' -mtime "+${BACKUP_RETENTION_DAYS}" | while IFS= read -r OLD_FILE; do
  if command -v shred >/dev/null 2>&1; then
    shred -u "$OLD_FILE"
  else
    rm -f "$OLD_FILE"
  fi
done

echo "Encrypted backup written: $OUT_FILE"
