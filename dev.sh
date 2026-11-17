#!/usr/bin/env bash
# Start the development stack from the repo root:
#   CNCjs backend  http://localhost:8000/   (legacy UI + API + Socket.IO)
#   PCB UI         http://localhost:5173/   (Vite; proxies /api and /socket.io to :8000)
# pcb2gcode is not a daemon — CNCjs launches it per CAM generate.
#
# Usage:
#   ./dev.sh            start both
#   ./dev.sh --rebuild  babel-rebuild the CNCjs server, then start both
#
# Ctrl+C stops both. Override the engine with PCB2GCODE_BIN=/path/to/pcb2gcode.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PCB2GCODE_BIN="${PCB2GCODE_BIN:-${HOME}/.local/bin/pcb2gcode}"
CNC_PORT=8000
WEB_PORT=5173
rebuild=0
if [[ "${1:-}" == "--rebuild" ]]; then
  rebuild=1
elif [[ -n "${1:-}" ]]; then
  echo "usage: ./dev.sh [--rebuild]" >&2
  exit 2
fi

if [[ ! -x "$ROOT/cncjs/bin/cncjs" ]]; then
  echo "cncjs launcher not found at cncjs/bin/cncjs" >&2
  exit 1
fi
if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
  echo "frontend dependencies missing. From frontend/: npm install" >&2
  exit 1
fi
if [[ ! -x "$PCB2GCODE_BIN" ]]; then
  echo "warning: pcb2gcode not executable at $PCB2GCODE_BIN — Generate toolpaths will fail until PCB2GCODE_BIN is set" >&2
fi

port_busy() {
  ss -ltn "sport = :$1" 2>/dev/null | grep -q ":$1"
}
if port_busy "$CNC_PORT"; then
  echo "port $CNC_PORT is already in use — stop the existing CNCjs process first" >&2
  exit 1
fi
if port_busy "$WEB_PORT"; then
  echo "port $WEB_PORT is already in use — stop the existing Vite process first" >&2
  exit 1
fi

if [[ "$rebuild" -eq 1 ]]; then
  echo "rebuilding CNCjs server into dist/…"
  (cd "$ROOT/cncjs" && NODE_ENV=production ./node_modules/.bin/babel src/server --out-dir dist/cncjs/server --ignore '**/__tests__/**')
fi

pids=()
cleanup() {
  local pid
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait || true
}
trap 'echo; echo "stopping…"; cleanup; exit 0' INT TERM

echo "CNCjs   http://localhost:${CNC_PORT}/"
echo "PCB UI  http://localhost:${WEB_PORT}/"
echo

(
  cd "$ROOT/cncjs"
  export PCB2GCODE_BIN
  export NODE_ENV=production
  exec ./bin/cncjs --port "$CNC_PORT"
) &
pids+=("$!")

(
  cd "$ROOT/frontend"
  exec npm run dev -- --host 127.0.0.1 --port "$WEB_PORT" --strictPort
) &
pids+=("$!")

# Exit when either process dies, then stop the other.
wait -n || true
echo "a process exited — stopping the rest"
cleanup
exit 1
