#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/backend"
if [[ ! -f spotify-api.jar ]]; then
  mvn package
  cp target/spotify-api-0.0.1-SNAPSHOT.jar spotify-api.jar
fi
exec java -jar spotify-api.jar
