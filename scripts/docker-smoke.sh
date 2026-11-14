#!/usr/bin/env sh
# Isolated Phase 3.3 Docker Compose deployment & smoke verification script.
# Uses a dedicated Compose project name and non-production isolated Postgres volume.
set -eu

PROJECT_NAME="${COMPOSE_PROJECT_NAME:-mw-hygiene-p33-isolated}"
PORT="${APP_PORT:-3000}"

if ! command -v docker >/dev/null 2>&1; then
  echo "BLOCKED: docker CLI is not installed on this host." >&2
  exit 2
fi

if ! docker info >/dev/null 2>&1; then
  echo "BLOCKED: Docker daemon is not running or unreachable." >&2
  exit 2
fi

echo "[1/6] Validating rendered Compose config..."
docker compose -p "$PROJECT_NAME" config >/dev/null

echo "[2/6] Building isolated web, migrate, and worker images..."
docker compose -p "$PROJECT_NAME" build

echo "[3/6] Starting PostgreSQL and running Prisma migrations..."
docker compose -p "$PROJECT_NAME" up -d postgres
docker compose -p "$PROJECT_NAME" run --rm migrate

echo "[4/6] Starting isolated web and worker services..."
docker compose -p "$PROJECT_NAME" up -d web worker

echo "[5/6] Checking /api/health and read-only mutation lock..."
i=0
until curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "FAIL: web health endpoint did not become ready within 60s." >&2
    docker compose -p "$PROJECT_NAME" logs --tail=50 web worker
    exit 1
  fi
  sleep 2
done

HEALTH_JSON="$(curl -fsS "http://127.0.0.1:${PORT}/api/health")"
echo "Health output: $HEALTH_JSON"
printf '%s' "$HEALTH_JSON" | grep -q '"mailwizzMutationsEnabled":false' || {
  echo "FAIL: ENABLE_MAILWIZZ_MUTATIONS is not false in running container!" >&2
  exit 1
}

echo "[6/6] Restarting worker & web to verify container recovery..."
docker compose -p "$PROJECT_NAME" restart web worker
sleep 5
curl -fsS "http://127.0.0.1:${PORT}/api/health" | grep -q '"status":"ok"'
docker compose -p "$PROJECT_NAME" ps

echo "SUCCESS: Isolated Docker stack verified cleanly."
