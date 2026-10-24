#!/usr/bin/env bash
# Dump the database to backups/tenderos-<time>.sql.gz and keep the newest 14.
#   sudo bash /opt/tenderos/deploy/backup.sh
# Restore (replaces the current database):
#   docker compose stop web
#   docker compose exec -T db dropdb -U tenderos tenderos
#   docker compose exec -T db createdb -U tenderos tenderos
#   gunzip -c backups/<file> | docker compose exec -T db psql -q -U tenderos -d tenderos
#   docker compose start web
# Uploaded files: docker compose exec -T web tar -xzf - -C /data < backups/tenderos-files-<time>.tar.gz
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"
mkdir -p backups
chmod 700 backups
if ! docker compose ps --status running db | grep -q db; then
  echo "database not running; no backup taken"
  exit 0
fi
file="backups/tenderos-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
docker compose exec -T db pg_dump -U tenderos -d tenderos | gzip > "$file"
echo "backup: $file ($(du -h "$file" | cut -f1))"
ls -1t backups/tenderos-*.sql.gz | tail -n +15 | xargs -r rm -f
# the files people uploaded on team assignments (signed copies)
if docker compose ps --status running web | grep -q web; then
  files="backups/tenderos-files-$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
  docker compose exec -T web tar -czf - -C /data files 2>/dev/null > "$files" && echo "files: $files ($(du -h "$files" | cut -f1))"
  ls -1t backups/tenderos-files-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
fi
