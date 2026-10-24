# VibeTimer — webpage, Spring Boot, lyric model and Spotify

Your mood and time come from the webpage. Spring Boot forwards the mood to Python. Python expands related words and ranks the complete imported Billboard catalogue using lyric word counts, with title/artist metadata as a fallback. The webpage finds those songs on Spotify, uses their actual `duration_ms` to fit your time, and lets you save a private Spotify playlist.

The complete 100-song Billboard file is included. The three large lyric files are not bundled: use the same files you already downloaded. No Spotify credentials are bundled.

## 1. Configure your Spotify app (once)

Open https://developer.spotify.com/dashboard and create or select your app. Select Web API if prompted. Add this exact redirect URI in its settings:

```
http://127.0.0.1:5173/callback
```

Copy the **Client ID**. In the extracted `vibe-timer-main` folder:

```bash
cp .env.example .env.local
open -e .env.local
```

Replace `replace_with_your_spotify_client_id` with the Client ID. Keep the redirect URI as above. No Client Secret is needed: this app uses Authorization Code with PKCE. Never put a Client Secret in a `VITE_` variable.

Spotify currently requires the owner of a Development Mode app to have Premium. Add your testing account(s) in the app's allowed users / User Management settings. New Development Mode apps allow five users. Use `127.0.0.1` in the browser; Spotify does not accept `localhost` as a callback hostname.

## 2. Start Spring Boot (terminal 1)

Install Java 17 or newer. In the extracted project folder:

```bash
bash scripts/start-java.sh
```

The included `backend/spotify-api.jar` is already built. Leave this terminal running. Stop any old Spring application using port 8080 before starting this one.

In a second terminal, from the same project folder, import the full catalogue:

```bash
bash scripts/import-billboard.sh
```

Look for `"rowsProcessed":100` and `"totalElements":100`. The database is saved under `backend/data`, so this import is only needed on first setup or after changing the data. Reimporting the file updates the same songs rather than duplicating them. Five rows have missing LyricIDs; the importer gives these distinct rank-based keys and removes the old shared `billboard-NaN` record. This fixes the previous 96-song catalogue. The Java database retains estimated 210-second durations for the older standalone endpoint; the web integration replaces those estimates with real Spotify durations before selecting tracks.

## 3. Start the lyric service (terminal 2)

Use **Python 3.11**, as in your working setup. Put these files in `data/lyrics/` inside this project (create that folder):

- `metadata_plus_LNS_360919_lyrics_20150707.txt`
- `LFID_WordIDs.txt`
- `LF_SUBTLEX_merged_20150719.txt`

Or copy `backend/ml-service/.env.example` to `backend/ml-service/.env` and replace each path with the actual file location on your Mac. Quote paths containing spaces. The launcher loads this file each time, so you do not need to repeat exports.

From the project root, install once:

```bash
python3.11 -m venv backend/ml-service/.venv311
backend/ml-service/.venv311/bin/python -m pip install -r backend/ml-service/requirements.txt
```

Then start it:

```bash
bash scripts/start-ml.sh
```

Leave this terminal running. Wait for `Application startup complete`. First launch downloads the sentence transformer and indexes the lyric vocabulary, so it takes longer. If you import more songs later, restart Python to refresh its catalogue.

## 4. Open the webpage (terminal 3)

Use Node.js 22.12+ or 24 LTS. From the project root:

```bash
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. After changing `.env.local`, restart `npm run dev`.

1. Click **Connect Spotify** and accept the permission request.
2. Enter a theme and a duration between 1 and 240 whole minutes.
3. Click **Find my playlist**. You will see matching progress and the catalogue count.
4. Click **Save private playlist to Spotify**.
5. Play it in Spotify or the embedded player, then click **Start timer**.

Spotify controls playback and availability. Browser autoplay is not assumed; press Play yourself. The timer does not start or pause music automatically. The playlist may end before the requested time because songs must fit whole and keep theme relevance. There is no guarantee of an exact duration or that every Billboard recording is available in your account's market.

## Reopen it later

Open three terminals in the project folder:

```bash
# Terminal 1
bash scripts/start-java.sh

# Terminal 2
bash scripts/start-ml.sh

# Terminal 3
npm run dev
```

Open http://127.0.0.1:5173 and connect Spotify. Dependencies and the Billboard import do not need repeating unless you reset the project or database. Tokens are kept only in the current browser tab's session storage; closing the tab or disconnecting clears the login.

## API and catalogue behaviour

| Endpoint | Purpose |
| --- | --- |
| Java `GET /api/health` | Spring liveness |
| Java `GET /api/tracks?page=0&size=100` | Imported catalogue |
| Java `POST /api/tracks/import-billboard` | Import the Billboard TSV |
| Java `POST /api/playlists/candidates` | Forward `{ "prompt": "rainy evening" }` to Python |
| Python `GET /health` | Loaded catalogue and matched lyric record counts |
| Python `POST /api/candidates` | Rank candidates without applying the time limit |
| Python `POST /api/playlists` | Original standalone API, using estimated durations |

Every imported catalogue song is considered. There is no top-10 candidate cutoff. Songs with no lyric match and low metadata similarity are omitted. `lyricRecordsMatched` counts corpus records, which can include multiple versions of one song; it is not the catalogue count.

Spotify's search `limit=10` is the number of possible recordings returned for **each song search**. All theme candidates are processed. Title and artist must match conservatively; covers, live versions, restrictions and unavailable recordings are skipped rather than silently substituted. A five-minute, in-memory match cache reduces repeated searches. Themes prioritize lyrics, not an accurate inferred genre: the Billboard source uses a generic `billboard` genre.

The duration selection is greedy in relevance order and never exceeds the requested time in milliseconds. It is not an optimizer for exact gap filling. Spotify metadata stays in the browser for lookup/display and is not supplied to or used to train the lyric model.

The current Spotify API routes are `GET /v1/search`, `POST /v1/me/playlists`, and `PUT /v1/playlists/{id}/items`. Only `playlist-modify-private` is requested. Saves use a per-tab checkpoint and replace playlist items so retrying an interrupted insertion does not duplicate songs. If the initial creation response itself is lost, Spotify may have created an empty playlist; check your library before another save.

## Troubleshooting

- **Address already in use:** stop your older Java, Python or Vite process with Ctrl+C in its terminal.
- **Spotify invalid redirect URI:** save the exact callback above in the Spotify dashboard; open `127.0.0.1`, not `localhost`.
- **Spotify 403:** check owner Premium, allowed users, and reconnect to grant the playlist permission.
- **Spotify 429:** wait for the time shown before trying again. Rate limits are not treated as successful empty results.
- **Lyric service unavailable:** wait for indexing to finish; check Python logs and the three file paths.
- **Only 10 catalogue songs shown:** run the full import, check `totalElements`, then restart Python.
- **No matches:** try broader theme words or a longer time. The corpus describes words, not full lyric lines.
- **Python import error:** install requirements using the `.venv311/bin/python` command above, then start with the launcher.

Check service health:

```bash
curl -f http://127.0.0.1:8080/api/health
curl -f http://127.0.0.1:8001/health
curl -f http://127.0.0.1:8080/api/playlists/candidates \
  -H 'Content-Type: application/json' -d '{"prompt":"rainy evening"}'
```

## Development and checks

```bash
npm test
npm run lint
npm run build
cd backend
mvn verify
```

`npm run dev` proxies `/api` to Java using `JAVA_API_URL`. Java uses `ML_SERVICE_URL` for Python (default `http://127.0.0.1:8001`). A deployed build needs an HTTPS host, a registered HTTPS callback and a same-origin reverse proxy for `/api` to Java. The local servers are intended for local development. The production preview command alone does not proxy API traffic.

The tests use simulated Spotify responses; a live Spotify login and playlist save must be checked with your own Client ID and permitted account. See `VALIDATION.md` for the checks performed for this delivery.

Official references: [PKCE login](https://developer.spotify.com/documentation/web-api/tutorials/code-pkce-flow), [redirect URIs](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri), [Development Mode changes](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide), [search](https://developer.spotify.com/documentation/web-api/reference/search), [create playlist](https://developer.spotify.com/documentation/web-api/reference/create-playlist).
