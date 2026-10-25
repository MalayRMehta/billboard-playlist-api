# Validation

The loader uses English rows with lyrics and replaces the catalogue in PostgreSQL. After `bash scripts/load-data.sh`, `GET http://127.0.0.1:8001/health` reports the imported song count.

Run frontend checks from `frontend/`:

```bash
npm test
npm run lint
npm run build
```

Manual check: connect Spotify, generate a timed mix, save it, and confirm playback and timer behavior.
