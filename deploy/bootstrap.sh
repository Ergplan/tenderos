#!/usr/bin/env bash
# Install TenderOS on a fresh Ubuntu/Debian VM: Docker, the repository, a .env with generated
# secrets, the containers (db, engine, web, caddy for HTTPS), and the administrator account.
# Safe to run again: it keeps an existing .env, database and administrator.
#
#   curl -fsSL https://raw.githubusercontent.com/Ergplan/tenderos/main/deploy/bootstrap.sh -o bootstrap.sh
#   sudo ADMIN_EMAIL=you@company.com bash bootstrap.sh
#
# Environment (all optional):
#   ADMIN_EMAIL        administrator login (default admin@tenderos.local)
#   SITE_ADDRESS       host name for HTTPS; default <external-ip>.sslip.io (no domain needed)
#   ANTHROPIC_API_KEY  enables model reading of tenders; without it the rules reader is used
#   BRANCH             git branch to deploy (default main)
#   TENDEROS_DIR       install directory (default /opt/tenderos)
#   SKIP_INSTALL=1     Docker and git are already installed
#   NO_BUILD=1         use images already built on this machine
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/Ergplan/tenderos.git}"
BRANCH="${BRANCH:-main}"
DIR="${TENDEROS_DIR:-/opt/tenderos}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@tenderos.local}"

say() { printf '\n==> %s\n' "$*"; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"

install_packages() {
  say "Installing Docker and git"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl git openssl >/dev/null
  if ! command -v docker >/dev/null 2>&1; then
    curl -fsSL https://get.docker.com | sh >/dev/null
  fi
  systemctl enable --now docker >/dev/null 2>&1 || true
  docker compose version >/dev/null || die "docker compose plugin missing"
}

fetch_code() {
  if [ -d "$DIR/.git" ]; then
    say "Updating $DIR to $BRANCH"
    git -C "$DIR" fetch -q origin "$BRANCH"
    git -C "$DIR" checkout -q "$BRANCH"
    git -C "$DIR" pull -q --ff-only origin "$BRANCH"
  else
    say "Cloning $REPO_URL ($BRANCH) into $DIR"
    git clone -q --branch "$BRANCH" "$REPO_URL" "$DIR"
  fi
}

external_ip() {
  curl -fsS -m 3 -H "Metadata-Flavor: Google" \
    "http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip" 2>/dev/null \
    || curl -fsS -m 5 https://api.ipify.org 2>/dev/null || true
}

write_env() {
  cd "$DIR"
  if [ -f .env ]; then
    say "Keeping the existing .env"
    return
  fi
  local site="${SITE_ADDRESS:-}"
  if [ -z "$site" ]; then
    local ip; ip="$(external_ip)"
    [ -n "$ip" ] || die "could not find the external IP; set SITE_ADDRESS"
    site="${ip//./-}.sslip.io"
  fi
  say "Writing .env (site: $site)"
  umask 077
  cat > .env <<EOF
COMPOSE_FILE=docker-compose.yml:deploy/docker-compose.vm.yml
SITE_ADDRESS=$site
POSTGRES_PASSWORD=$(openssl rand -hex 24)
SESSION_SECRET=$(openssl rand -hex 32)
COOKIE_SECURE=true
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
EXTRACTION_MODEL=
EXTRACTION_REQUIRE_LLM=
EOF
}

env_value() { grep -E "^$1=" "$DIR/.env" | head -1 | cut -d= -f2-; }

start_app() {
  cd "$DIR"
  if [ "${NO_BUILD:-}" != "1" ]; then
    say "Building images (a few minutes the first time)"
    docker compose build -q
  fi
  # The app starts without Caddy, so nothing is reachable from outside until the
  # administrator exists.
  say "Starting db, engine and web"
  docker compose up -d db engine web
  for _ in $(seq 1 90); do
    if docker compose exec -T web wget -qO- http://127.0.0.1:3000/api/health 2>/dev/null | grep -q '"database":"ok"'; then
      return
    fi
    sleep 2
  done
  docker compose logs --tail 40 web engine
  die "the web app did not become healthy"
}

create_admin() {
  cd "$DIR"
  local body status
  local password; password="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  body=$(printf '{"name":"Administrator","email":"%s","password":"%s","confirm":"%s"}' "$ADMIN_EMAIL" "$password" "$password")
  status=$(docker compose exec -T web wget -qO- --header "content-type: application/json" \
    --post-data "$body" http://127.0.0.1:3000/api/auth/setup 2>&1 || true)
  if printf '%s' "$status" | grep -q '"ok":true\|"user"'; then
    umask 077
    printf 'TenderOS administrator\nURL: https://%s\nEmail: %s\nPassword: %s\n' \
      "$(env_value SITE_ADDRESS)" "$ADMIN_EMAIL" "$password" > /root/tenderos-admin.txt
    say "Administrator created: $ADMIN_EMAIL (password in /root/tenderos-admin.txt)"
    ADMIN_PASSWORD="$password"
  else
    say "An administrator already exists; keeping it"
  fi
}

open_site() {
  cd "$DIR"
  say "Starting Caddy (HTTPS)"
  docker compose up -d caddy
  local site; site="$(env_value SITE_ADDRESS)"
  for _ in $(seq 1 60); do
    if curl -fsS -m 5 "https://$site/api/health" >/dev/null 2>&1; then
      say "TenderOS is up: https://$site"
      return
    fi
    sleep 3
  done
  say "WARNING: https://$site did not answer yet. Check that ports 80 and 443 reach this VM and that"
  echo "the name resolves to it; then: docker compose -f $DIR/docker-compose.yml -f $DIR/deploy/docker-compose.vm.yml logs caddy"
}

[ "${SKIP_INSTALL:-}" = "1" ] || install_packages
fetch_code
write_env
start_app
ADMIN_PASSWORD=""
create_admin
open_site

echo
echo "  URL:       https://$(env_value SITE_ADDRESS)"
echo "  Login:     $ADMIN_EMAIL"
[ -n "$ADMIN_PASSWORD" ] && echo "  Password:  $ADMIN_PASSWORD   (also in /root/tenderos-admin.txt)"
if [ -z "$(env_value ANTHROPIC_API_KEY)" ]; then
  echo "  Reading:   rules reader (no ANTHROPIC_API_KEY); add the key to $DIR/.env and run deploy/update.sh"
fi
echo "  Update:    sudo bash $DIR/deploy/update.sh"
