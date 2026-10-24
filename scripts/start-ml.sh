#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend/ml-service"
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi
export LYRICS_METADATA_PATH="${LYRICS_METADATA_PATH:-$ROOT/data/lyrics/metadata_plus_LNS_360919_lyrics_20150707.txt}"
export LYRICS_WORD_IDS_PATH="${LYRICS_WORD_IDS_PATH:-$ROOT/data/lyrics/LFID_WordIDs.txt}"
export LYRIC_WORD_MAP_PATH="${LYRIC_WORD_MAP_PATH:-$ROOT/data/lyrics/LF_SUBTLEX_merged_20150719.txt}"
for file in "$LYRICS_METADATA_PATH" "$LYRICS_WORD_IDS_PATH" "$LYRIC_WORD_MAP_PATH"; do
  if [[ ! -f "$file" ]]; then
    printf 'Missing lyric file: %s\nSee README.md for setup.\n' "$file" >&2
    exit 1
  fi
done
if [[ ! -x .venv311/bin/python ]]; then
  printf 'Create the Python environment first. See README.md, step 3.\n' >&2
  exit 1
fi
exec .venv311/bin/python -m uvicorn app:app --host 127.0.0.1 --port 8001
