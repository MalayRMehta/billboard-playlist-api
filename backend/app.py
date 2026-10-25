from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer
import catalogue_db

MODEL_NAME = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
app = FastAPI(title="Spotify Theme Playlist API", version="1.0.0")
encoder: SentenceTransformer | None = None
catalog: list[dict[str, Any]] = []


def refresh_catalogue() -> None:
    global catalog
    catalog = catalogue_db.all_tracks()


class CandidateRequest(BaseModel):
    prompt: str = Field(min_length=2, max_length=240)
    target_minutes: int = Field(ge=1, le=240)


def score_track(track: dict[str, Any], lyric_similarity: float) -> dict[str, Any]:
    """Build a candidate and its score; combine other track signals here as needed."""
    return {
        "trackId": track["track_id"],
        "title": track["track_name"],
        "artists": track["artists"],
        "durationMs": track["duration_ms"],
        "relevance": round(float(lyric_similarity), 6),
    }


def score_candidates(vector: Any, target_minutes: int) -> list[dict[str, Any]]:
    target_ms = target_minutes * 60_000
    expected_tracks = (target_minutes * 60 + 15 + 149) // 150
    batch_size = expected_tracks * 2
    rows: list[dict[str, Any]] = []
    cursor: tuple[float, str] | None = None

    while True:
        batch = catalogue_db.nearest_tracks(vector, limit=batch_size, cursor=cursor)
        if not batch:
            break
        rows.extend(score_track(result["track"], result["similarity"]) for result in batch)
        cursor = batch[-1]["cursor"]

        total_ms = 0
        selected_count = 0
        for track in sorted(rows, key=lambda row: row["relevance"], reverse=True):
            duration_ms = track["durationMs"]
            if duration_ms > 0 and total_ms + duration_ms <= target_ms:
                total_ms += duration_ms
                selected_count += 1
            if total_ms >= target_ms - 30_000 or selected_count == 100:
                break
        if total_ms >= target_ms - 30_000 or selected_count == 100:
            break

    return rows


@app.on_event("startup")
def initialize() -> None:
    global encoder
    catalogue_db.create_database()
    try:
        encoder = SentenceTransformer(MODEL_NAME)
    except (OSError, RuntimeError) as exc:
        print(f"Playlist index unavailable during startup: {exc}")
        return
    refresh_catalogue()
    print(f"Loaded {len(catalog)} persisted catalogue songs.")


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "UP", "catalogTracks": len(catalog),
            "databaseTracks": catalogue_db.count_tracks()}


@app.get("/api/health")
def api_health() -> dict[str, str]:
    return {"status": "UP", "catalogue": "Spotify lyrics"}


@app.get("/api/tracks")
def get_tracks(page: int = 0, size: int = 20, genre: str | None = None, q: str | None = None) -> dict[str, Any]:
    if page < 0 or size < 1 or size > 200:
        raise HTTPException(status_code=400, detail="page must be >= 0; size must be between 1 and 200")
    return catalogue_db.get_tracks(page, size, genre, q)


@app.get("/api/tracks/{track_id}")
def get_track(track_id: str) -> list[dict[str, Any]]:
    result = catalogue_db.get_track(track_id)
    if not result:
        raise HTTPException(status_code=404, detail="Track not found")
    return result


@app.post("/api/candidates")
def candidates(request: CandidateRequest) -> dict[str, Any]:
    if encoder is None:
        raise HTTPException(status_code=503, detail="Playlist index is still starting")
    prompt = request.prompt.strip()
    if len(prompt) < 2:
        raise HTTPException(status_code=422, detail="Enter at least two non-space characters")
    vector = encoder.encode(prompt, convert_to_numpy=True, normalize_embeddings=True)
    rows = score_candidates(vector, request.target_minutes)
    return {"prompt": prompt, "catalogTracks": len(catalog), "candidates": rows}


