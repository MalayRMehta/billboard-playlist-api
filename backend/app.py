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


class PlaylistRequest(BaseModel):
    prompt: str = Field(min_length=2, max_length=240, examples=["rainy evening, mellow indie"])
    target_minutes: int = Field(ge=1, le=240, examples=[30])
    max_tracks: int = Field(default=100, ge=1, le=100)


class CandidateRequest(BaseModel):
    prompt: str = Field(min_length=2, max_length=240)
    target_minutes: int = Field(ge=1, le=240)


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
    rows = []
    expected_tracks = (request.target_minutes * 60 + 149) // 150
    candidate_limit = expected_tracks * 2
    for result in catalogue_db.nearest_tracks(vector, limit=candidate_limit):
        track = result["track"]
        similarity = result["similarity"]
        rows.append({"trackId": track["track_id"], "title": track["track_name"],
                     "artists": track["artists"], "genre": track["track_genre"],
                     "durationMs": track["duration_ms"],
                     "relevance": round(float(similarity), 6),
                     "matchSource": "lyrics"})
    rows.sort(key=lambda row: row["relevance"], reverse=True)
    return {"prompt": prompt, "catalogTracks": len(catalog), "candidates": rows}


@app.post("/api/playlists")
def create_playlist(request: PlaylistRequest) -> dict[str, Any]:
    if encoder is None:
        raise HTTPException(status_code=503, detail="Playlist index is still starting")
    target_seconds = request.target_minutes * 60
    query_vector = encoder.encode(request.prompt, convert_to_numpy=True, normalize_embeddings=True)
    expected_tracks = (request.target_minutes * 60 + 149) // 150
    matches = [
        {"track": result["track"], "relevance": result["similarity"]}
        for result in catalogue_db.nearest_tracks(query_vector, limit=expected_tracks * 2)
    ]
    if not matches:
        return {
            "prompt": request.prompt,
            "targetMinutes": request.target_minutes,
            "totalDurationSeconds": 0,
            "tracks": [],
            "message": "No songs are loaded in the catalogue.",
        }
    selected: list[dict[str, Any]] = []
    selected_ids: set[str] = set()
    total_seconds = 0
    remaining = target_seconds
    for match in matches:
        row = match["track"]
        track_id = str(row["track_id"])
        if track_id in selected_ids:
            continue
        duration = max(1, int(row["duration_ms"]) // 1000)
        if duration > remaining:
            continue
        score = float(match["relevance"])
        selected.append({
            "trackId": track_id,
            "title": row.get("track_name"),
            "artists": row.get("artists"),
            "genre": row.get("track_genre"),
            "durationSeconds": duration,
            "relevance": round(score, 4),
        })
        selected_ids.add(track_id)
        total_seconds += duration
        remaining -= duration
        if not remaining or len(selected) >= request.max_tracks:
            break
    return {
        "prompt": request.prompt,
        "targetMinutes": request.target_minutes,
        "totalDurationSeconds": total_seconds,
        "durationMinutes": round(total_seconds / 60, 1),
        "tracks": selected,
        "message": "Matched using lyric embeddings. Song lengths come from the Spotify dataset.",
    }
