from __future__ import annotations

import os
import time
from typing import Any

import psycopg
from pgvector.psycopg import register_vector
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql://billboard:billboard@127.0.0.1:5433/billboard"
)


def connect() -> psycopg.Connection:
    connection = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    register_vector(connection)
    return connection


def create_database() -> None:
    """Create the persistent catalogue table and pgvector extension if needed."""
    last_error: Exception | None = None
    for _ in range(30):
        try:
            with psycopg.connect(DATABASE_URL) as connection:
                connection.execute("CREATE EXTENSION IF NOT EXISTS vector")
                register_vector(connection)
                connection.execute(
                    """CREATE TABLE IF NOT EXISTS tracks (
                        track_id VARCHAR(128) NOT NULL,
                        genre VARCHAR(128) NOT NULL,
                        payload JSONB NOT NULL,
                        embedding VECTOR(384) NOT NULL,
                        PRIMARY KEY (track_id, genre)
                    )"""
                )
                connection.execute(
                    "CREATE INDEX IF NOT EXISTS tracks_embedding_idx "
                    "ON tracks USING hnsw (embedding vector_cosine_ops)"
                )
            return
        except psycopg.OperationalError as exc:
            last_error = exc
            time.sleep(2)
    raise RuntimeError(f"Could not connect to catalogue database: {last_error}")


def replace_tracks(tracks: list[dict[str, Any]], vectors: Any) -> None:
    records = [
        (track["track_id"], track["track_genre"], Jsonb(track), vector)
        for track, vector in zip(tracks, vectors, strict=True)
    ]
    with connect() as connection:
        connection.execute("TRUNCATE TABLE tracks")
        with connection.cursor() as cursor:
            cursor.executemany(
                """INSERT INTO tracks (track_id, genre, payload, embedding)
                   VALUES (%s, %s, %s, %s)""",
                records,
            )


def count_tracks() -> int:
    with connect() as connection:
        return connection.execute("SELECT COUNT(*) AS count FROM tracks").fetchone()["count"]


def get_tracks(page: int, size: int, genre: str | None, query: str | None) -> dict[str, Any]:
    clauses: list[str] = []
    values: list[Any] = []
    if genre and genre.strip():
        clauses.append("genre = %s")
        values.append(genre.strip())
    if query and query.strip():
        clauses.append("(LOWER(payload->>'track_name') LIKE %s OR LOWER(payload->>'artists') LIKE %s)")
        match = f"%{query.strip().lower()}%"
        values.extend([match, match])
    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    with connect() as connection:
        total = connection.execute(
            f"SELECT COUNT(*) AS count FROM tracks{where}", values
        ).fetchone()["count"]
        rows = connection.execute(
            f"SELECT payload FROM tracks{where} ORDER BY track_id, genre LIMIT %s OFFSET %s",
            [*values, size, page * size],
        ).fetchall()
    return {
        "items": [row["payload"] for row in rows],
        "page": page,
        "size": size,
        "totalElements": total,
        "totalPages": (total + size - 1) // size,
    }


def get_track(track_id: str) -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute(
            "SELECT payload FROM tracks WHERE track_id = %s ORDER BY genre", (track_id,)
        ).fetchall()
    return [row["payload"] for row in rows]


def nearest_tracks(
    vector: Any,
    limit: int = 1000,
    cursor: tuple[float, str] | None = None,
) -> list[dict[str, Any]]:
    with connect() as connection:
        if cursor is None:
            rows = connection.execute(
                """SELECT payload, embedding <=> %s AS distance
                   FROM tracks ORDER BY distance, track_id LIMIT %s""",
                (vector, limit),
            ).fetchall()
        else:
            last_distance, last_track_id = cursor
            rows = connection.execute(
                """SELECT payload, embedding <=> %s AS distance
                   FROM tracks
                   WHERE (embedding <=> %s) > %s
                      OR ((embedding <=> %s) = %s AND track_id > %s)
                   ORDER BY distance, track_id LIMIT %s""",
                (vector, vector, last_distance, vector, last_distance, last_track_id, limit),
            ).fetchall()
    return [
        {
            "track": row["payload"],
            "similarity": 1 - float(row["distance"]),
            "cursor": (float(row["distance"]), row["payload"]["track_id"]),
        }
        for row in rows
    ]


def all_tracks() -> list[dict[str, Any]]:
    with connect() as connection:
        rows = connection.execute("SELECT payload FROM tracks ORDER BY track_id, genre").fetchall()
    return [row["payload"] for row in rows]
