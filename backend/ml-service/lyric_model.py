from __future__ import annotations

import csv
import os
import re
import unicodedata
from pathlib import Path
from typing import Any

import numpy as np
from rapidfuzz.fuzz import token_set_ratio
from scipy.sparse import csr_matrix
from sklearn.feature_extraction.text import TfidfTransformer
from sentence_transformers import SentenceTransformer

BASE = Path(__file__).resolve().parents[2]
ATTACHMENTS = BASE.parent / "upload"
META_PATH = Path(os.getenv("LYRICS_METADATA_PATH", ATTACHMENTS / "metadata_plus_LNS_360919_lyrics_20150707.txt"))
IDS_PATH = Path(os.getenv("LYRICS_WORD_IDS_PATH", ATTACHMENTS / "LFID_WordIDs.txt"))
WORDS_PATH = Path(os.getenv("LYRIC_WORD_MAP_PATH", ATTACHMENTS / "LF_SUBTLEX_merged_20150719.txt"))


def normalise(text: str) -> str:
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return " ".join(re.findall(r"[a-z0-9]+", text.lower()))


class LyricIndex:
    def __init__(self, encoder: SentenceTransformer, catalog: list[dict[str, Any]]):
        self.encoder = encoder
        self.catalog: list[dict[str, Any]] = []
        self.vectors: csr_matrix | None = None
        self.words: list[str] = []
        self.word_vectors: np.ndarray | None = None
        self.match_count = 0
        self._build(catalog)

    def _build(self, catalog: list[dict[str, Any]]) -> None:
        missing = [str(p) for p in (META_PATH, IDS_PATH, WORDS_PATH) if not p.is_file()]
        if missing:
            raise RuntimeError(
                "Attach the three lyric index files and set LYRICS_METADATA_PATH, "
                "LYRICS_WORD_IDS_PATH, and LYRIC_WORD_MAP_PATH. Missing: " + ", ".join(missing)
            )

        by_title: dict[str, list[dict[str, Any]]] = {}
        for t in catalog:
            key = normalise(str(t.get("track_name", "")))
            if key:
                by_title.setdefault(key, []).append(t)

        by_lyric_id = {str(t["lyric_id"]): t for t in catalog if t.get("lyric_id")}
        matches: dict[str, dict[str, Any]] = {}
        with META_PATH.open(encoding="cp1252", newline="") as f:
            for row in csv.DictReader(f, delimiter="\t"):
                lyric_id = row.get("lyric_id", "").strip()
                if lyric_id in by_lyric_id:
                    matches[lyric_id] = {**row, "_track": by_lyric_id[lyric_id]}
                    continue
                options = by_title.get(normalise(row.get("song_title", "")), [])
                if not lyric_id or not options:
                    continue
                artist = normalise(row.get("song_artist_name", ""))
                ranked = [(token_set_ratio(artist, normalise(str(t.get("artists", "")))), t) for t in options]
                score, track = max(ranked, key=lambda p: p[0])
                if score >= 75:
                    matches[lyric_id] = {**row, "_track": track}

        word_map: dict[int, str] = {}
        with WORDS_PATH.open(encoding="cp1252", newline="") as f:
            for row in csv.DictReader(f, delimiter="\t"):
                try:
                    word_map[int(row["wordID"])] = row["lyric_word"].lower()
                except (ValueError, KeyError):
                    continue

        doc_counts: list[dict[int, int]] = []
        doc_meta: list[dict[str, Any]] = []
        with IDS_PATH.open(encoding="ascii") as f:
            for line in f:
                lyric_id, sep, encoded = line.rstrip("\r\n").partition("[")
                meta = matches.get(lyric_id)
                if not sep or meta is None:
                    continue
                ids = np.fromstring(encoded.rstrip("]"), sep=";", dtype=np.int32)
                if ids.size:
                    unique, counts = np.unique(ids, return_counts=True)
                    counts_by_word = {int(i): int(c) for i, c in zip(unique, counts) if int(i) in word_map}
                    if counts_by_word:
                        doc_counts.append(counts_by_word)
                        doc_meta.append(meta)

        if not doc_counts:
            raise RuntimeError(
                "No lyric records matched the Billboard catalogue. "
                "Import the Billboard songs file into the Java API first."
            )

        document_frequency: dict[int, int] = {}
        for doc in doc_counts:
            for word_id in doc:
                document_frequency[word_id] = document_frequency.get(word_id, 0) + 1
        keep = [
            word_id for word_id, _ in sorted(
                document_frequency.items(), key=lambda pair: (-pair[1], pair[0])
            )[:16000]
            if word_map[word_id].isalpha() and len(word_map[word_id]) > 2
        ]
        col = {word_id: j for j, word_id in enumerate(keep)}
        rr: list[int] = []
        cc: list[int] = []
        vv: list[float] = []
        for i, doc in enumerate(doc_counts):
            for word_id, count in doc.items():
                j = col.get(word_id)
                if j is not None:
                    rr.append(i)
                    cc.append(j)
                    vv.append(float(count))

        counts = csr_matrix((vv, (rr, cc)), shape=(len(doc_counts), len(keep)), dtype=np.float32)
        self.vectors = TfidfTransformer().fit_transform(counts).tocsr()
        self.catalog = doc_meta
        self.words = [word_map[word_id] for word_id in keep]
        self.word_vectors = self.encoder.encode(
            self.words, batch_size=128, convert_to_numpy=True,
            normalize_embeddings=True, show_progress_bar=False,
        ).astype("float32")
        self.match_count = len(doc_counts)

    def search(self, prompt: str, limit: int = 300) -> tuple[list[dict[str, Any]], list[str]]:
        assert self.vectors is not None and self.word_vectors is not None
        prompt_vector = self.encoder.encode(
            prompt, convert_to_numpy=True, normalize_embeddings=True
        ).astype("float32")
        similarities = self.word_vectors @ prompt_vector
        tokens = set(re.findall(r"[a-z][a-z'-]{2,}", prompt.lower()))
        indexes = [
            int(i) for i in np.argsort(similarities)[::-1]
            if self.words[int(i)] not in tokens and similarities[int(i)] >= 0.24
        ][:8]
        weights = np.zeros(len(self.words), dtype="float32")
        for i, word in enumerate(self.words):
            if word in tokens:
                weights[i] = 1.0
        for i in indexes:
            weights[i] = max(float(weights[i]), float(similarities[i]))
        query = csr_matrix(weights.reshape(1, -1))
        scores = np.asarray((self.vectors @ query.T).toarray()).ravel()

        # Merge lyric variants into one catalogue track. Durations may be estimates.
        best: dict[str, tuple[float, dict[str, Any]]] = {}
        for score, entry in zip(scores, self.catalog):
            track = entry["_track"]
            track_id = str(track["track_id"])
            previous = best.get(track_id)
            if previous is None or float(score) > previous[0]:
                best[track_id] = (float(score), track)
        ordered = sorted(best.values(), key=lambda pair: pair[0], reverse=True)[:limit]
        results = [
            {"track": track, "relevance": score}
            for score, track in ordered if score > 0
        ]
        return results, [self.words[i] for i in indexes]
