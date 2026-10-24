# Spotify Tracks API

Java 17 / Spring Boot 3.5 API for importing and retrieving the Billboard all-time songs list. The companion `ml-service/` searches the attached lyric word-count files. This setup does not use the Spotify Tracks dataset.

## Run

The download includes a built executable JAR. With Java 17+ installed, run from the extracted project directory:

```bash
java -jar spotify-api.jar
```

To build and run from source instead:

Install Java 17+ and Maven 3.9+, then run from this directory:

```bash
mvn clean verify
mvn spring-boot:run
```

The API runs at http://localhost:8080. H2 stores data in `./data/spotify.mv.db` and retains it across restarts. The first run starts with an empty database. Stop the application before copying the database files.

The Billboard file has no song lengths, so the demo assigns an estimated 210 seconds (3.5 minutes) per song. See `ml-service/README.md` to start the playlist service.

Alternatively, with Docker:

```bash
docker build -t spotify-api .
docker run --rm -p 8080:8080 -v spotify-data:/app/data spotify-api
```

## Import Billboard songs

Use the attached tab-separated `billboard_top_100_all_time_songs.txt` file. The artists file is not needed for this import.

```bash
curl -f -X POST http://localhost:8080/api/tracks/import-billboard -F 'file=@/path/to/billboard_top_100_all_time_songs.txt'
```

The importer reads the Billboard artist, title, rank, year, and LyricID fields. It uses LyricID as the stable song key, with a rank-based fallback for the five songs missing LyricID. Each duration is marked as an estimate of 210 seconds; this is not a measured song length. Reimporting updates existing entries.

## Endpoints

| Method | Path | Behavior |
| --- | --- | --- |
| GET | `/api/health` | Application liveness |
| POST | `/api/tracks/import-billboard` | Multipart Billboard tab-separated file, field `file` |
| GET | `/api/tracks?page=0&size=20` | Paginated entries, ordered by track ID and genre |
| GET | `/api/tracks?genre=pop&q=love` | Exact genre filter and case-insensitive name/artist substring search |
| GET | `/api/tracks/{trackId}` | Billboard song record for this lyric ID; 404 if absent |

Pages are zero-based; `size` is 1–200. Genre and search filters can be combined. An empty list returns HTTP 200 with zero totals. Invalid parameters and CSV rows return 400; uploads exceeding configured limits return 413. Errors use Spring problem-details JSON.

```bash
curl -f 'http://localhost:8080/api/tracks?page=0&size=20'
curl -f 'http://localhost:8080/api/tracks?genre=pop&q=demo'
curl -f 'http://localhost:8080/api/tracks/demo-track-1'
```

List response shape:

```json
{
  "items": [{"track_id": "demo-track-1", "track_genre": "pop", "track_name": "Demo, One", "popularity": 55}],
  "page": 0,
  "size": 20,
  "totalElements": 2,
  "totalPages": 1
}
```

The example abbreviates each item; Billboard rank, year, and LyricID are included. List totals count imported song records.

## Configuration and scope

`PORT` defaults to `8080`. `DB_URL` defaults to `jdbc:h2:file:./data/spotify`; `DB_PASSWORD` defaults to empty. This is a local development API with no authentication. Protect the import endpoint and configure authentication before exposing it publicly. Search uses SQL parameters. The Billboard importer streams TSV records in batches of 100.

The database stores imported Billboard records as JSON alongside indexed identity fields. `BillboardImportService` handles Billboard TSV import; `TrackStore` handles persistence.

## Tests

`mvn verify` covers CSV quoting/BOM/index handling, multi-genre entries, idempotent imports, pagination, filters, literal search input, validation, missing tracks, and rollback after a batch has already been written. Test data uses a separate in-memory database.
