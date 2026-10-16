#!/usr/bin/env bash
# Update a VM install: back up the database, pull the branch, rebuild and restart.
#   sudo bash /opt/tenderos/deploy/update.sh
# Also run it after editing .env (for example to add ANTHROPIC_API_KEY).
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
bash deploy/backup.sh
git pull -q --ff-only
docker compose build -q
docker compose up -d
docker image prune -f >/dev/null
site="$(grep -E '^SITE_ADDRESS=' .env | cut -d= -f2-)"
for _ in $(seq 1 40); do
  curl -fsS -m 5 "https://$site/api/health" && { echo; echo "updated: https://$site"; exit 0; }
  sleep 3
done
echo "WARNING: https://$site/api/health did not answer; docker compose logs web engine caddy" >&2
exit 1
