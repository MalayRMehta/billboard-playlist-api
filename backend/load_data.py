from __future__ import annotations

import argparse
import csv
import json
import os
from pathlib import Path
from typing import Any

import numpy as np
from sentence_transformers import SentenceTransformer

import catalogue_db

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_FILE = ROOT / "data" / "spotify_songs.csv"
DEFAULT_FILE = Path(os.getenv("SPOTIFY_DATASET_PATH", DEFAULT_FILE))
MODEL_NAME = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
CHUNK_WORDS = 160


def number(value: str | None, kind: type[int] | type[float]) -> int | float | None:
    if value is None or not value.strip():
        return None
    try:
        parsed = kind(value)
        if isinstance(parsed, float) and not np.isfinite(parsed):
            return None
        return parsed
    except ValueError:
        return None


def read_spotify_songs(path: Path) -> tuple[list[dict[str, Any]], list[str]]:
    tracks: list[dict[str, Any]] = []
    lyrics: list[str] = []
    seen: set[str] = set()
    with path.open(encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        required = {"track_id", "track_name", "track_artist", "lyrics", "duration_ms", "language"}
        missing = sorted(required - set(reader.fieldnames or []))
        if missing:
            raise ValueError(f"Missing Spotify dataset columns: {', '.join(missing)}")

        for line_number, row in enumerate(reader, start=2):
            track_id = (row.get("track_id") or "").strip()
            title = (row.get("track_name") or "").strip()
            artist = (row.get("track_artist") or "").strip()
            lyric = (row.get("lyrics") or "").strip()
            if (row.get("language") or "").strip().lower() != "en":
                continue
            if not track_id or not title or not artist or not lyric or track_id in seen:
                continue
            duration = number(row.get("duration_ms"), int)
            if duration is None or duration <= 0:
                continue

            genre = (row.get("playlist_genre") or "unknown").strip().lower() or "unknown"
            track: dict[str, Any] = {
                "track_id": track_id,
                "track_name": title,
                "artists": artist,
                "track_genre": genre,
                "track_subgenre": (row.get("playlist_subgenre") or "").strip(),
                "popularity": number(row.get("track_popularity"), int),
                "album_name": (row.get("track_album_name") or "").strip(),
                "album_release_date": (row.get("track_album_release_date") or "").strip(),
                "playlist_name": (row.get("playlist_name") or "").strip(),
                "playlist_genre": genre,
                "playlist_subgenre": (row.get("playlist_subgenre") or "").strip(),
                "danceability": number(row.get("danceability"), float),
                "energy": number(row.get("energy"), float),
                "key": number(row.get("key"), int),
                "loudness": number(row.get("loudness"), float),
                "mode": number(row.get("mode"), int),
                "speechiness": number(row.get("speechiness"), float),
                "acousticness": number(row.get("acousticness"), float),
                "instrumentalness": number(row.get("instrumentalness"), float),
                "liveness": number(row.get("liveness"), float),
                "valence": number(row.get("valence"), float),
                "tempo": number(row.get("tempo"), float),
                "duration_ms": duration,
                "language": "en",
            }
            tracks.append(track)
            lyrics.append(lyric)
            seen.add(track_id)
    if not tracks:
        raise ValueError("No English songs with lyrics were found in the Spotify dataset")
    return tracks, lyrics


def embed_lyrics(encoder: SentenceTransformer, lyrics: list[str]) -> np.ndarray:
    chunks: list[str] = []
    owners: list[int] = []
    for song_index, lyric in enumerate(lyrics):
        words = lyric.split()
        for start in range(0, len(words), CHUNK_WORDS):
            chunks.append(" ".join(words[start:start + CHUNK_WORDS]))
            owners.append(song_index)

    chunk_vectors = encoder.encode(
        chunks,
        batch_size=128,
        convert_to_numpy=True,
        normalize_embeddings=True,
        show_progress_bar=True,
    ).astype("float32")
    song_vectors = np.zeros((len(lyrics), chunk_vectors.shape[1]), dtype="float32")
    np.add.at(song_vectors, np.asarray(owners), chunk_vectors)
    song_vectors /= np.bincount(owners, minlength=len(lyrics)).astype("float32")[:, None]
    norms = np.linalg.norm(song_vectors, axis=1, keepdims=True)
    song_vectors /= np.maximum(norms, 1e-12)
    return song_vectors


def main() -> None:
    parser = argparse.ArgumentParser(description="Embed English Spotify lyrics and replace the song catalogue")
    parser.add_argument("file", nargs="?", type=Path, default=DEFAULT_FILE)
    source = parser.parse_args().file
    tracks, lyrics = read_spotify_songs(source)

    catalogue_db.create_database()
    encoder = SentenceTransformer(MODEL_NAME)
    vectors = embed_lyrics(encoder, lyrics)
    catalogue_db.replace_tracks(tracks, vectors)
    print(json.dumps({"rowsProcessed": len(tracks), "databaseTracks": catalogue_db.count_tracks()}))


if __name__ == "__main__":
    main()
