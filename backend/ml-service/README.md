# Integrated webpage setup

For this package, follow `../../README.md` and `../../scripts/start-ml.sh`. The webpage uses `/api/candidates` for ranking before Spotify duration fitting. The original standalone API below remains available.

# Theme playlist service

This service uses the attached lyric word-count files to match a short front-end prompt, suggests semantically related words, and chooses matching Billboard tracks that fit within the requested time.

The attached files represent lyrics as word IDs and per-song word counts, not complete lyric text or lines. The service uses the metadata file to associate lyric IDs with titles and artists, the word-ID file for per-song counts, and the SUBTLEX file to map IDs to words. It matches title and artist against the Billboard catalogue. It can search for words and themes represented by the counts, but cannot search word order, exact lyric lines, or quotes.

The lyric files have no duration information. Since this project uses the Billboard list, the API assigns an explicitly estimated 210 seconds to each imported song. The service skips lyric records that cannot be matched confidently by title and artist.

## Run

1. Start the Java API and import the Billboard all-time songs tab-separated file using the command in the parent README. Keep the three attached lyric files in a local folder. By default, this service expects them in the conversation's upload folder next to the project. Set explicit paths if they are elsewhere:

   ```bash
   export LYRICS_METADATA_PATH="/path/to/metadata_plus_LNS_360919_lyrics_20150707.txt"
   export LYRICS_WORD_IDS_PATH="/path/to/LFID_WordIDs.txt"
   export LYRIC_WORD_MAP_PATH="/path/to/LF_SUBTLEX_merged_20150719.txt"
   ```

2. From this directory, create a virtual environment and install requirements:

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   python3 -m pip install -r requirements.txt
   ```

3. Start the service:

   ```bash
   uvicorn app:app --host 127.0.0.1 --port 8001
   ```

On first start it downloads the pretrained sentence-transformer model, loads Billboard songs and estimated durations from the Java API, matches lyric metadata by normalized title and artist, parses word counts for matched lyric IDs, and embeds the usable vocabulary. Initial indexing can take several minutes. Change CATALOG_API if Spring runs elsewhere. Model and index files are not bundled.

## Request

POST /api/playlists

```json
{
  "prompt": "rainy evening, mellow indie",
  "target_minutes": 30,
  "max_tracks": 100
}
```

The prompt must be 2–240 characters; target_minutes must be 1–240; max_tracks defaults to 100 and must be 1–100. For example:

```bash
curl -X POST http://localhost:8001/api/playlists \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"rainy evening, mellow indie","target_minutes":30}'
```

The response includes related terms, track title and artists, genre, estimated duration, relevance, and total playlist duration. GET /health reports loaded track and matched lyric counts. The playlist length is an upper limit; the result may be shorter when there aren't enough suitable short songs.

Later, user likes and skips can improve ranking. The attached files support word-count matching, but cannot support full lyric text or lyric excerpts.
