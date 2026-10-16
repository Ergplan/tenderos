#!/usr/bin/env bash
# Put TenderOS beside the old app on the shared VM (tariff-order, 34.131.67.235), behind one
# address: http://<vm>:8081/ shows a chooser between the old app and TenderOS.
#
#   curl -fsSL https://raw.githubusercontent.com/Ergplan/tenderos/main/deploy/shared-vm/install.sh -o install.sh
#   sudo bash install.sh
#
# What it does, in order (the old app keeps serving until step 4):
#   1. checks the old app (compose project fdre-dashboard) is running; clones TenderOS to /opt/tenderos
#   2. writes /opt/tenderos/.env (generated secrets; kept on a rerun)
#   3. builds and starts TenderOS (db, engine, web) with no published port
#   4. re-publishes the old app's web container on 127.0.0.1:8082 instead of 8081 (its database,
#      engine and data are not touched; about 10 seconds of downtime)
#   5. starts the router on 8081: the chooser, the old app and TenderOS (demo mode, no sign-in)
# Undo: sudo bash /opt/tenderos/deploy/shared-vm/rollback.sh
#
# Environment (optional): BRANCH (default main), TENDEROS_DIR (/opt/tenderos), ANTHROPIC_API_KEY,
# OLD_WEB (fdre-dashboard-web-1), OLD_INTERNAL_PORT (8082), SKIP_BUILD=1 (images already built).
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Ergplan/tenderos.git}"
BRANCH="${BRANCH:-main}"
DIR="${TENDEROS_DIR:-/opt/tenderos}"
OLD_WEB="${OLD_WEB:-fdre-dashboard-web-1}"
OLD_INTERNAL_PORT="${OLD_INTERNAL_PORT:-8082}"
ROUTER_PORT=8081

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"
command -v docker >/dev/null && docker compose version >/dev/null || die "docker with the compose plugin is required"

# ---- 1. the old app and the code
docker inspect "$OLD_WEB" >/dev/null 2>&1 || die "$OLD_WEB is not running; this script is for the VM that runs the old app"
label() { docker inspect "$1" --format "{{ index .Config.Labels \"$2\" }}"; }
OLD_PROJECT="$(label "$OLD_WEB" com.docker.compose.project)"
OLD_WORKDIR="$(label "$OLD_WEB" com.docker.compose.project.working_dir)"
OLD_FILES="$(label "$OLD_WEB" com.docker.compose.project.config_files)"
OLD_NETWORK="$(docker inspect "$OLD_WEB" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' | awk '{print $1}')"
OLD_BINDING="$(docker port "$OLD_WEB" 3000/tcp | head -1 || true)"
say "Old app: project $OLD_PROJECT in $OLD_WORKDIR, network $OLD_NETWORK, published on ${OLD_BINDING:-nothing}"

mem_gb=$(awk '/MemTotal/ {printf "%d", $2/1048576}' /proc/meminfo)
avail_mb=$(awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo)
if [ "$avail_mb" -lt 2500 ]; then
  echo "NOTE: ${avail_mb} MB of memory is free (${mem_gb} GB in all). Building TenderOS needs about 2 GB;"
  echo "      running it about 0.5 GB (measured while sizing a 1,200 MW tender). Add swap or a larger VM if the build fails."
fi

if [ -d "$DIR/.git" ]; then
  say "Updating $DIR ($BRANCH)"
  git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" checkout -q "$BRANCH" && git -C "$DIR" pull -q --ff-only origin "$BRANCH"
else
  say "Cloning TenderOS ($BRANCH) into $DIR"
  git clone -q --branch "$BRANCH" "$REPO_URL" "$DIR"
fi
cd "$DIR"

# ---- 2. settings
if [ ! -f .env ]; then
  say "Writing $DIR/.env"
  umask 077
  cat > .env <<ENV
COMPOSE_PROJECT_NAME=tenderos
COMPOSE_FILE=docker-compose.yml:deploy/shared-vm/docker-compose.shared.yml
OLD_APP_NETWORK=$OLD_NETWORK
ROUTER_PORT=$ROUTER_PORT
POSTGRES_PASSWORD=$(openssl rand -hex 24)
SESSION_SECRET=$(openssl rand -hex 32)
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
EXTRACTION_MODEL=
EXTRACTION_REQUIRE_LLM=
ENV
else
  say "Keeping the existing $DIR/.env"
fi
echo "OLD_BINDING=${OLD_BINDING}" > .old-app-binding.tmp
[ -f .old-app-binding ] || mv .old-app-binding.tmp .old-app-binding
rm -f .old-app-binding.tmp

# ---- 3. TenderOS
if [ "${SKIP_BUILD:-}" != "1" ]; then
  say "Building TenderOS (5 to 10 minutes the first time; the old app keeps running)"
  docker compose build -q
fi
say "Starting TenderOS"
docker compose up -d db engine web
for _ in $(seq 1 90); do
  docker compose exec -T web wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null | grep -q '"database":"ok"' && break
  sleep 2
done
docker compose exec -T web wget -qO- http://127.0.0.1:3000/api/health | grep -q '"database":"ok"' || die "TenderOS did not become healthy (docker compose logs web engine)"

# ---- 4. the old app off port 8081
old_compose() {
  local args=(-p "$OLD_PROJECT" --project-directory "$OLD_WORKDIR" --env-file /dev/null)
  local f; IFS=',' read -ra files <<< "$OLD_FILES"; for f in "${files[@]}"; do args+=(-f "$f"); done
  envof() { docker inspect "$1" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n "s/^$2=//p"; }
  POSTGRES_PASSWORD="$(envof "${OLD_PROJECT}-db-1" POSTGRES_PASSWORD)" \
  SESSION_SECRET="$(envof "$OLD_WEB" SESSION_SECRET)" \
  COOKIE_SECURE="$(envof "$OLD_WEB" COOKIE_SECURE)" \
  WEB_PORT="$1" \
    docker compose "${args[@]}" up -d --no-deps --no-build web
}
case "$OLD_BINDING" in
  127.0.0.1:*) say "Old app already internal ($OLD_BINDING)" ;;
  *)
    say "Moving the old app from ${OLD_BINDING:-?} to 127.0.0.1:$OLD_INTERNAL_PORT"
    old_compose "127.0.0.1:$OLD_INTERNAL_PORT"
    ;;
esac

# ---- 5. the router on 8081
say "Starting the router on port $ROUTER_PORT"
if ! docker compose up -d router; then
  echo "Router failed to start; putting the old app back on its port" >&2
  bash "$DIR/deploy/shared-vm/rollback.sh" || true
  exit 1
fi
sleep 3
chooser=$(curl -fsS -m 5 "http://127.0.0.1:$ROUTER_PORT/" | grep -c "Choose an app" || true)
new=$(curl -fsS -m 10 -H "Cookie: tenderos_app=new" "http://127.0.0.1:$ROUTER_PORT/api/health" || true)
old=$(curl -fsS -m 10 -H "Cookie: tenderos_app=old" "http://127.0.0.1:$ROUTER_PORT/api/health" || true)
echo "  chooser: $([ "$chooser" -ge 1 ] && echo ok || echo MISSING)"
echo "  new app: ${new:-no answer}"
echo "  old app: ${old:-no answer}"
ip="$(curl -fsS -m 3 -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip 2>/dev/null || hostname -I | awk '{print $1}')"
say "Open http://$ip:$ROUTER_PORT/"
