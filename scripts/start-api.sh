#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
docker compose -f "$ROOT/docker-compose.yml" up -d catalogue-db
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi
PYTHON_BIN="${PYTHON_BIN:-$ROOT/backend/.venv311/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then PYTHON_BIN=python3; fi
exec "$PYTHON_BIN" -m uvicorn app:app --host 127.0.0.1 --port 8001
