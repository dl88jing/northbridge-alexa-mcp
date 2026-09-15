#!/usr/bin/env bash
# One-command offline demo (+ optional serve) for Northbridge Home Ops.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

MODE="${1:-demo}"

if [[ ! -d .venv ]]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q -e .

case "$MODE" in
  demo|"")
    python -m northbridge.demo
    ;;
  serve)
    echo "Starting MCP + Control Plane on http://127.0.0.1:8765 ..."
    echo "  MCP:  http://127.0.0.1:8765/mcp"
    echo "  API:  http://127.0.0.1:8765/api/health"
    python -m northbridge.server
    ;;
  web)
    if [[ ! -d web/node_modules ]]; then
      (cd web && npm install)
    fi
    (cd web && npm run dev -- --host 127.0.0.1 --port 5173)
    ;;
  all)
    python -m northbridge.demo
    if [[ ! -d web/node_modules ]]; then
      (cd web && npm install)
    fi
    python -m northbridge.server &
    MCP_PID=$!
    trap 'kill $MCP_PID 2>/dev/null || true' EXIT
    sleep 1
    (cd web && npm run dev -- --host 127.0.0.1 --port 5173)
    ;;
  *)
    echo "Usage: ./demo.sh [demo|serve|web|all]"
    exit 1
    ;;
esac
