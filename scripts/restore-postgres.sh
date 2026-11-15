#!/usr/bin/env sh
# Authenticated encrypted PostgreSQL restore script (age AEAD + legacy .enc)
# Never stores decrypted dumps on disk; supply off-VPS age identity only during restore.
set -eu

DUMP_FILE="${1:-}"
IDENTITY_FILE="${2:-${BACKUP_AGE_IDENTITY_FILE:-}}"

if [ -z "$DUMP_FILE" ] || [ ! -f "$DUMP_FILE" ]; then
  echo "Usage: $0 <path-to-hygiene_db_timestamp.dump.age> [path-to-age-identity-file]" >&2
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

load_env_var "POSTGRES_USER"
load_env_var "POSTGRES_DB"

if [ -f "${DUMP_FILE}.sha256" ]; then
  sha256sum -c "${DUMP_FILE}.sha256"
fi

case "$DUMP_FILE" in
  *.dump.age)
    if ! command -v age >/dev/null 2>&1; then
      echo "Error: 'age' is required to decrypt '$DUMP_FILE'." >&2
      exit 1
    fi
    if [ -z "$IDENTITY_FILE" ] || [ ! -f "$IDENTITY_FILE" ]; then
      echo "Error: Provide off-VPS age private recovery identity file as arg 2 or BACKUP_AGE_IDENTITY_FILE." >&2
      exit 1
    fi
    age -d -i "$IDENTITY_FILE" "$DUMP_FILE" </dev/null | \
      docker compose exec -T postgres pg_restore \
        -U "${POSTGRES_USER:-hygiene_user}" \
        -d "${POSTGRES_DB:-mailwizz_hygiene}" \
        --clean --if-exists
    ;;
  *.dump.enc)
    if ! command -v openssl >/dev/null 2>&1; then
      echo "Error: openssl is required to decrypt legacy '$DUMP_FILE'." >&2
      exit 1
    fi
    load_env_var "BACKUP_ENCRYPTION_KEY"
    if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ] || [ "${#BACKUP_ENCRYPTION_KEY}" -lt 32 ]; then
      echo "Error: Dedicated BACKUP_ENCRYPTION_KEY (>=32 chars) must be set explicitly to restore legacy .dump.enc files." >&2
      exit 1
    fi
    export BACKUP_ENCRYPTION_KEY
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_ENCRYPTION_KEY -in "$DUMP_FILE" </dev/null | \
      docker compose exec -T postgres pg_restore \
        -U "${POSTGRES_USER:-hygiene_user}" \
        -d "${POSTGRES_DB:-mailwizz_hygiene}" \
        --clean --if-exists
    ;;
  *)
    echo "Error: Refusing unencrypted or unrecognized dump '$DUMP_FILE'. Only *.dump.age (or legacy *.dump.enc) are supported." >&2
    exit 1
    ;;
esac

echo "Restore complete from: $DUMP_FILE"
