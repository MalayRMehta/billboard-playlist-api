#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
curl --fail-with-body -X POST "${JAVA_API_URL:-http://127.0.0.1:8080}/api/tracks/import-billboard" \
  -F "file=@$ROOT/data/billboard_top_100_all_time_songs.txt"
printf '\n'
curl --fail-with-body "${JAVA_API_URL:-http://127.0.0.1:8080}/api/tracks?page=0&size=1"
printf '\n'
