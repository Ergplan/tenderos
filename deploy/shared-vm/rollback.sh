#!/usr/bin/env bash
# Undo deploy/shared-vm/install.sh: stop the router and put the old app back on the port it
# had before (8081). TenderOS is stopped but its data is kept; install.sh starts it again.
#   sudo bash /opt/tenderos/deploy/shared-vm/rollback.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
OLD_WEB="${OLD_WEB:-fdre-dashboard-web-1}"
cd "$DIR"
docker compose stop router 2>/dev/null || true
docker compose rm -f router 2>/dev/null || true
binding="$(sed -n 's/^OLD_BINDING=//p' .old-app-binding 2>/dev/null || true)"
port="${binding##*:}"; port="${port:-8081}"
label() { docker inspect "$OLD_WEB" --format "{{ index .Config.Labels \"$1\" }}"; }
envof() { docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n "s/^$2=//p"; }
project="$(label com.docker.compose.project)"
args=(-p "$project" --project-directory "$(label com.docker.compose.project.working_dir)" --env-file /dev/null)
IFS=',' read -ra files <<< "$(label com.docker.compose.project.config_files)"
for f in "${files[@]}"; do args+=(-f "$f"); done
POSTGRES_PASSWORD="$(envof "${project}-db-1" POSTGRES_PASSWORD)" \
SESSION_SECRET="$(envof "$OLD_WEB" SESSION_SECRET)" \
COOKIE_SECURE="$(envof "$OLD_WEB" COOKIE_SECURE)" \
WEB_PORT="$port" \
  docker compose "${args[@]}" up -d --no-deps --no-build web
docker compose stop web engine db 2>/dev/null || true
echo "Old app back on port $port: $(docker port "$OLD_WEB" 3000/tcp | head -1)"
