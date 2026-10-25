# VibeTimer

React playlist timer. Python embeds English lyrics from the [Kaggle Spotify songs dataset](https://www.kaggle.com/datasets/imuhammad/audio-features-and-lyrics-of-spotify-songs), stored locally as `data/spotify_songs.csv`, and ranks songs against a mood prompt. The frontend uses the dataset Spotify IDs directly and fits tracks to the requested time.

## Setup

1. Register a Spotify app with redirect URI `http://127.0.0.1:5173/callback`. Copy `frontend/.env.example` to `frontend/.env.local` and set `VITE_SPOTIFY_CLIENT_ID`.
2. Install Python requirements (Python 3.11; Docker required for PostgreSQL):

   ```bash
   python3.11 -m venv backend/.venv311
   backend/.venv311/bin/python -m pip install -r backend/requirements.txt
   ```

3. Load songs and lyric embeddings into persistent PostgreSQL volume `billboard-db-data`:

   ```bash
   bash scripts/load-data.sh
   ```

4. Start the query API:

   ```bash
   bash scripts/start-api.sh
   ```

5. In another terminal, start the webpage:

   ```bash
   cd frontend
   npm ci
   npm run dev
   ```

Open http://127.0.0.1:5173. To reload the dataset, stop the API, rerun `scripts/load-data.sh`, then restart it. The loader keeps English songs with lyrics and replaces the catalogue contents.

Check the first three dataset IDs against Spotify with `SPOTIFY_ACCESS_TOKEN=... python3 scripts/check-spotify-ids.py`.

## API

- `GET /api/health`
- `GET /api/tracks?page=0&size=20&genre=rock&q=love`
- `GET /api/tracks/{trackId}`
- `POST /api/candidates` with `{"prompt":"rainy evening","target_minutes":30}`
- `POST /api/playlists` with `{"prompt":"rainy evening","target_minutes":30}`
- `GET /health`
