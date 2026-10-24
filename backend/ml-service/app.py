from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any

import numpy as np
import requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from sentence_transformers import SentenceTransformer
from sklearn.feature_extraction.text import ENGLISH_STOP_WORDS, TfidfVectorizer
from lyric_model import LyricIndex

CATALOG_API = os.getenv("CATALOG_API", "http://localhost:8080/api")
MODEL_NAME = os.getenv("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
CACHE_DIR = Path(os.getenv("MODEL_CACHE_DIR", ".cache"))
MAX_TARGET_SECONDS = 4 * 60 * 60

app = FastAPI(title="Spotify Theme Playlist API", version="1.0.0")
encoder: SentenceTransformer | None = None
catalog: list[dict[str, Any]] = []
track_vectors: np.ndarray | None = None
term_vectors: np.ndarray | None = None
terms: list[str] = []
index_signature: str | None = None
lyric_index: LyricIndex | None = None


class PlaylistRequest(BaseModel):
    prompt: str = Field(min_length=2, max_length=240, examples=["rainy evening, mellow indie"])
    target_minutes: int = Field(ge=1, le=240, examples=[30])
    max_tracks: int = Field(default=100, ge=1, le=100)


class CandidateRequest(BaseModel):
    prompt: str = Field(min_length=2, max_length=240)


def track_text(track: dict[str, Any]) -> str:
    return (
        f"Song title: {track.get('track_name', '')}. "
        f"Artist: {track.get('artists', '')}. "
        f"Genre: {track.get('track_genre', '')}."
    )


def load_catalog() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    page = 0
    while True:
        response = requests.get(
            f"{CATALOG_API}/tracks",
            params={"page": page, "size": 200},
            timeout=60,
        )
        response.raise_for_status()
        body = response.json()
        rows.extend(body.get("items", []))
        if page + 1 >= int(body.get("totalPages", 0)):
            break
        page += 1
    unique: dict[tuple[str, str], dict[str, Any]] = {}
    for row in rows:
        track_id = str(row.get("track_id", "")).strip()
        genre = str(row.get("track_genre", "")).strip()
        try:
            duration_ms = int(row.get("duration_ms", 0))
        except (TypeError, ValueError):
            continue
        if track_id and genre and duration_ms > 0 and row.get("track_name"):
            unique[(track_id, genre)] = row
    return list(unique.values())


def make_signature(rows: list[dict[str, Any]]) -> str:
    digest = hashlib.sha256()
    for row in rows:
        digest.update(track_text(row).encode("utf-8", errors="replace"))
        digest.update(str(row.get("track_id", "")).encode())
        digest.update(str(row.get("duration_ms", "")).encode())
        digest.update(b"\n")
    return digest.hexdigest()


def expand_terms(prompt: str, original_vector: np.ndarray) -> list[int]:
    assert encoder is not None and term_vectors is not None
    words = re.findall(r"[a-z][a-z'-]{2,}", prompt.lower())
    excluded = set(words) | set(ENGLISH_STOP_WORDS)
    scores = term_vectors @ original_vector
    order = np.argsort(scores)[::-1]
    chosen: list[int] = []
    chosen_set: set[str] = set()
    for idx in order:
        term = terms[int(idx)]
        tokens = term.split()
        if any(token in excluded for token in tokens) or term in chosen_set:
            continue
        if scores[idx] < 0.24:
            break
        chosen.append(int(idx))
        chosen_set.add(term)
        if len(chosen) == 8:
            break
    return chosen


def build_index(rows: list[dict[str, Any]]) -> None:
    global catalog, track_vectors, term_vectors, terms, index_signature
    assert encoder is not None
    catalog = rows
    signature = make_signature(rows)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    vector_path = CACHE_DIR / f"catalog-{signature}.npy"
    terms_path = CACHE_DIR / f"terms-{signature}.json"
    term_vectors_path = CACHE_DIR / f"term-vectors-{signature}.npy"
    if vector_path.exists() and terms_path.exists() and term_vectors_path.exists():
        track_vectors = np.load(vector_path, mmap_mode="r")
        terms = json.loads(terms_path.read_text(encoding="utf-8"))
        term_vectors = np.load(term_vectors_path, mmap_mode="r")
    else:
        texts = [track_text(row) for row in rows]
        track_vectors = encoder.encode(
            texts,
            batch_size=128,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=True,
        ).astype("float32")
        vectorizer = TfidfVectorizer(
            strip_accents="unicode",
            lowercase=True,
            stop_words="english",
            ngram_range=(1, 2),
            max_features=4000,
            token_pattern=r"(?u)\b[a-zA-Z][a-zA-Z'-]{2,}\b",
        )
        vectorizer.fit(texts)
        terms = list(vectorizer.get_feature_names_out())
        term_vectors = encoder.encode(
            terms,
            batch_size=128,
            convert_to_numpy=True,
            normalize_embeddings=True,
            show_progress_bar=False,
        ).astype("float32")
        np.save(vector_path, track_vectors)
        np.save(term_vectors_path, term_vectors)
        terms_path.write_text(json.dumps(terms), encoding="utf-8")
        track_vectors = np.load(vector_path, mmap_mode="r")
        term_vectors = np.load(term_vectors_path, mmap_mode="r")
    index_signature = signature


@app.on_event("startup")
def initialize() -> None:
    global encoder, lyric_index
    encoder = SentenceTransformer(MODEL_NAME)
    try:
        rows = load_catalog()
    except requests.RequestException as exc:
        raise RuntimeError(
            f"Cannot load tracks from {CATALOG_API}. Start the Java API and import the Billboard file first."
        ) from exc
    if not rows:
        raise RuntimeError("The track catalogue is empty. Import the Billboard file first.")
    global catalog, index_signature
    catalog = rows
    index_signature = make_signature(rows)
    lyric_index = LyricIndex(encoder, rows)
    build_index(rows)
    print(f"Loaded {len(rows)} Billboard songs; matched {lyric_index.match_count} lyric records.")


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "UP", "catalogTracks": len(catalog),
            "lyricRecordsMatched": lyric_index.match_count if lyric_index else 0,
            "index": index_signature}


@app.post("/api/candidates")
def candidates(request: CandidateRequest) -> dict[str, Any]:
    if lyric_index is None or encoder is None or track_vectors is None:
        raise HTTPException(status_code=503, detail="Playlist index is still starting")
    prompt = request.prompt.strip()
    if len(prompt) < 2:
        raise HTTPException(status_code=422, detail="Enter at least two non-space characters")
    # Rank the complete catalogue BEFORE any duration or playlist-size selection.
    matches, expanded = lyric_index.search(prompt, limit=len(catalog))
    scores = {str(m["track"]["track_id"]): float(m["relevance"]) for m in matches}
    vector = encoder.encode(prompt, convert_to_numpy=True, normalize_embeddings=True)
    title_scores = track_vectors @ vector
    rows = []
    for track, similarity in zip(catalog, title_scores):
        lyric_score = scores.get(str(track["track_id"]), 0.0)
        # Title/artist/genre metadata supplies a fallback where lyric words do not match.
        title_score = max(0.0, float(similarity))
        if lyric_score <= 0 and title_score < 0.30:
            continue
        rows.append({"trackId": track["track_id"], "title": track["track_name"],
                     "artists": track["artists"], "genre": track["track_genre"],
                     "relevance": round(lyric_score + 0.2 * title_score, 6),
                     "matchSource": "lyrics" if lyric_score > 0 else "title and artist"})
    rows.sort(key=lambda row: row["relevance"], reverse=True)
    return {"prompt": prompt, "expandedTerms": expanded, "catalogTracks": len(catalog),
            "lyricRecordsMatched": lyric_index.match_count, "candidates": rows}


@app.post("/api/playlists")
def create_playlist(request: PlaylistRequest) -> dict[str, Any]:
    if lyric_index is None:
        raise HTTPException(status_code=503, detail="Playlist index is still starting")
    target_seconds = request.target_minutes * 60
    matches, expanded_terms = lyric_index.search(request.prompt)
    if not matches:
        return {
            "prompt": request.prompt,
            "expandedTerms": expanded_terms,
            "targetMinutes": request.target_minutes,
            "totalDurationSeconds": 0,
            "tracks": [],
            "message": "No lyric word matches were found; try another theme.",
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
        "expandedTerms": expanded_terms,
        "targetMinutes": request.target_minutes,
        "totalDurationSeconds": total_seconds,
        "durationMinutes": round(total_seconds / 60, 1),
        "tracks": selected,
        "message": "Matched using lyric word counts. Song lengths are estimated at 210 seconds each; the playlist fits within the requested time.",
    }
