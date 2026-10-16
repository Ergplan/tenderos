#!/usr/bin/env bash
# Start the engine (:8000) and the web app (:3000) as local processes, after the database is up.
# Env: DATABASE_URL (postgres://...), SESSION_SECRET, optional ANTHROPIC_API_KEY for model reading.
# Logs: /tmp/tenderos-engine.log, /tmp/tenderos-web.log. Stop: tools/dev.sh stop
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN=/tmp/tenderos-run
mkdir -p "$RUN"
stop() {
  for name in engine web; do
    if [ -f "$RUN/$name.pid" ]; then
      pid=$(cat "$RUN/$name.pid"); pkill -TERM -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null; rm -f "$RUN/$name.pid"
    fi
  done
}
if [ "${1:-}" = "stop" ]; then stop; exit 0; fi
stop; sleep 1
(cd "$ROOT" && exec .venv/bin/python -m uvicorn engine.app:app --host 127.0.0.1 --port 8000 > /tmp/tenderos-engine.log 2>&1) &
echo $! > "$RUN/engine.pid"
(cd "$ROOT/web" && ENGINE_URL=http://127.0.0.1:8000 exec node node_modules/next/dist/bin/next start -p 3000 > /tmp/tenderos-web.log 2>&1) &
echo $! > "$RUN/web.pid"
for i in $(seq 1 60); do curl -sf http://127.0.0.1:8000/api/health >/dev/null && curl -sf -o /dev/null http://127.0.0.1:3000/login && break; sleep 1; done
curl -s http://127.0.0.1:8000/api/health; echo
curl -s -o /dev/null -w "web /login: %{http_code}\n" http://127.0.0.1:3000/login
