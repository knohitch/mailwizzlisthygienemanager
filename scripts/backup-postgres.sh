#!/usr/bin/env sh
# Authenticated encrypted PostgreSQL logical backup script (age AEAD)
# Uses a dedicated public recipient (BACKUP_AGE_RECIPIENT); the private recovery
# identity stays strictly outside the VPS and APP_ENCRYPTION_KEY is never reused.
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
load_env_var "BACKUP_AGE_RECIPIENT"
load_env_var "POSTGRES_USER"
load_env_var "POSTGRES_DB"

if ! command -v age >/dev/null 2>&1; then
  echo "Error: 'age' is required for authenticated backup encryption (https://age-encryption.org)." >&2
  exit 1
fi

BACKUP_AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
case "$BACKUP_AGE_RECIPIENT" in
  age1[0-9a-z]*) ;;
  *)
    echo "Error: BACKUP_AGE_RECIPIENT (public 'age1...' key separate from APP_ENCRYPTION_KEY) must be set." >&2
    exit 1
    ;;
esac

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${BACKUP_DIR}/hygiene_db_${TIMESTAMP}.dump.age"

# Stream pg_dump directly into age AEAD encryption so no plaintext dump touches disk.
docker compose exec -T postgres pg_dump \
  -U "${POSTGRES_USER:-hygiene_user}" \
  -d "${POSTGRES_DB:-mailwizz_hygiene}" \
  -F c </dev/null | age -r "$BACKUP_AGE_RECIPIENT" -o "$OUT_FILE"

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

echo "Authenticated age backup written: $OUT_FILE"
