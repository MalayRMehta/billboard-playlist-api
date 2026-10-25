#!/usr/bin/env python3
"""Check the first three dataset track IDs against Spotify's catalog."""

import csv
import json
import os
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DATASET = ROOT / "data" / "spotify_songs.csv"


def check_track(track_id: str, token: str) -> dict[str, object]:
    request = Request(
        f"https://api.spotify.com/v1/tracks/{track_id}?market=US",
        headers={"Authorization": f"Bearer {token}"},
    )
    for attempt in range(4):
        try:
            with urlopen(request, timeout=20) as response:
                track = json.load(response)
            return {
                "dataset_id": track_id,
                "spotify_id": track.get("id"),
                "matches": track.get("id") == track_id,
                "title": track.get("name"),
                "artists": [artist["name"] for artist in track.get("artists", [])],
            }
        except HTTPError as error:
            if error.code == 429 and attempt < 3:
                time.sleep(max(1, int(error.headers.get("Retry-After", "2"))))
                continue
            if error.code == 404:
                return {"dataset_id": track_id, "matches": False, "reason": "not found"}
            raise
        except URLError as error:
            raise RuntimeError(f"Could not reach Spotify: {error.reason}") from error
    raise RuntimeError("Spotify rate limit retry limit reached")


def main() -> int:
    token = os.getenv("SPOTIFY_ACCESS_TOKEN")
    if not token:
        print("Set SPOTIFY_ACCESS_TOKEN before running this script.", file=sys.stderr)
        return 2
    if not DATASET.is_file():
        print(f"Dataset not found: {DATASET}", file=sys.stderr)
        return 2

    with DATASET.open(encoding="utf-8-sig", newline="") as source:
        rows = csv.DictReader(source)
        track_ids = [
            (row.get("track_id") or "").strip()
            for row in rows
            if (row.get("track_id") or "").strip()
        ][:3]

    if len(track_ids) < 3:
        print(f"Expected 3 track IDs, found {len(track_ids)}.", file=sys.stderr)
        return 2

    try:
        results = [check_track(track_id, token) for track_id in track_ids]
    except (HTTPError, RuntimeError) as error:
        print(str(error), file=sys.stderr)
        return 2
    print(json.dumps(results, indent=2))
    return 0 if all(result.get("matches") for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
