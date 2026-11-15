#!/usr/bin/env sh
# Encrypted PostgreSQL restore script for MailWizz List Hygiene Manager
set -eu

DUMP_FILE="${1:-}"
if [ -z "$DUMP_FILE" ] || [ ! -f "$DUMP_FILE" ]; then
  echo "Usage: $0 <path-to-hygiene_db_timestamp.dump.enc>" >&2
  exit 1
fi

case "$DUMP_FILE" in
  *.enc) ;;
  *)
    echo "Error: Refusing unencrypted dump '$DUMP_FILE'. Only *.dump.enc encrypted backups are supported." >&2
    exit 1
    ;;
esac

if ! command -v openssl >/dev/null 2>&1; then
  echo "Error: openssl is required to decrypt database backups." >&2
  exit 1
fi

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

load_env_var "BACKUP_ENCRYPTION_KEY"
load_env_var "APP_ENCRYPTION_KEY"
load_env_var "POSTGRES_USER"
load_env_var "POSTGRES_DB"

BACKUP_ENC_KEY="${BACKUP_ENCRYPTION_KEY:-${APP_ENCRYPTION_KEY:-}}"
if [ -z "$BACKUP_ENC_KEY" ] || [ "${#BACKUP_ENC_KEY}" -lt 32 ]; then
  echo "Error: BACKUP_ENCRYPTION_KEY or APP_ENCRYPTION_KEY (>=32 chars) must be set." >&2
  exit 1
fi
export BACKUP_ENC_KEY

if [ -f "${DUMP_FILE}.sha256" ]; then
  sha256sum -c "${DUMP_FILE}.sha256"
fi

openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_ENC_KEY -in "$DUMP_FILE" </dev/null | \
  docker compose exec -T postgres pg_restore \
    -U "${POSTGRES_USER:-hygiene_user}" \
    -d "${POSTGRES_DB:-mailwizz_hygiene}" \
    --clean --if-exists

echo "Restore complete from: $DUMP_FILE"
