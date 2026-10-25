#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi
docker compose -f "$ROOT/docker-compose.yml" up -d catalogue-db
PYTHON_BIN="${PYTHON_BIN:-$ROOT/backend/.venv311/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then PYTHON_BIN=python3; fi
exec "$PYTHON_BIN" load_data.py "${SPOTIFY_DATASET_PATH:-$ROOT/data/spotify_songs.csv}"
