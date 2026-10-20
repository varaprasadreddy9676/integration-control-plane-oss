#!/usr/bin/env bash
# Resets the demo stack to a fresh install: empty database, defaults seeded,
# one super admin. Run from the repository root of the install being recorded.
set -euo pipefail
STACK_DIR="${1:-.}"
cd "$STACK_DIR"
docker compose exec -T mongodb mongosh --quiet integration_gateway --eval 'db.dropDatabase()' >/dev/null
docker compose restart backend >/dev/null
for _ in $(seq 1 60); do curl -sf http://localhost:3545/ >/dev/null && break; sleep 2; done
docker compose exec -T backend node scripts/create-user.js \
  --email "${ADMIN_EMAIL:-admin@example.com}" --password "${ADMIN_PASSWORD:-ChangeMe123!}" --role SUPER_ADMIN >/dev/null
echo "Fresh install ready: ${ADMIN_EMAIL:-admin@example.com}"
