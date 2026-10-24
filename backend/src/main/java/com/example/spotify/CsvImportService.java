package com.example.spotify;

import org.apache.commons.csv.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

@Service
public class CsvImportService {
    private static final List<String> TEXT = List.of("track_id", "artists", "album_name", "track_name", "track_genre");
    private static final List<String> INTEGERS = List.of("popularity", "duration_ms", "key", "mode", "time_signature");
    private static final List<String> DECIMALS = List.of("danceability", "energy", "loudness", "speechiness", "acousticness", "instrumentalness", "liveness", "valence", "tempo");
    private static final Set<String> UNIT_INTERVAL = Set.of("danceability", "energy", "speechiness", "acousticness", "instrumentalness", "liveness", "valence");
    private final TrackStore store;

    public CsvImportService(TrackStore store) { this.store = store; }

    @Transactional(rollbackFor = Exception.class)
    public ImportResult load(MultipartFile file) throws IOException {
        if (file.isEmpty()) throw new IllegalArgumentException("Upload a non-empty UTF-8 CSV file");
        // The original CSV may begin with an unnamed index column or UTF-8 BOM.
        try (var reader = new PushbackReader(new InputStreamReader(file.getInputStream(), StandardCharsets.UTF_8), 1)) {
            int first = reader.read();
            if (first != -1 && first != 0xFEFF) reader.unread(first);
            try (var csv = CSVFormat.DEFAULT.builder().setHeader().setSkipHeaderRecord(true)
                    .setAllowMissingColumnNames(true).setDuplicateHeaderMode(DuplicateHeaderMode.ALLOW_EMPTY)
                    .get().parse(reader)) {
                var required = new ArrayList<String>();
                required.addAll(TEXT); required.addAll(INTEGERS); required.addAll(DECIMALS); required.add("explicit");
                var missing = required.stream().filter(h -> !csv.getHeaderMap().containsKey(h)).toList();
                if (!missing.isEmpty()) throw new IllegalArgumentException("Missing CSV columns: " + missing);
                var batch = new ArrayList<Map<String, Object>>();
                long rows = 0;
                for (var row : csv) {
                    batch.add(parse(row)); rows++;
                    if (batch.size() == 500) { store.upsert(batch); batch.clear(); }
                }
                if (rows == 0) throw new IllegalArgumentException("CSV has no data rows");
                if (!batch.isEmpty()) store.upsert(batch);
                return new ImportResult(rows, "Upserted by (track_id, track_genre); other stored tracks retained");
            }
        } catch (UncheckedIOException e) {
            throw new IllegalArgumentException("Malformed CSV; import rolled back", e);
        }
    }

    private Map<String, Object> parse(CSVRecord row) {
        try {
            if (!row.isConsistent()) throw new IllegalArgumentException("Column count differs from header");
            var track = new LinkedHashMap<String, Object>();
            for (String key : TEXT) track.put(key, row.get(key));
            if (row.get("track_id").isBlank() || row.get("track_genre").isBlank())
                throw new IllegalArgumentException("track_id and track_genre are required");
            if (row.get("track_id").length() > 128 || row.get("track_genre").length() > 128
                    || row.get("track_name").length() > 4096 || row.get("artists").length() > 4096)
                throw new IllegalArgumentException("Track identifier or metadata exceeds storage limit");
            for (String key : INTEGERS) {
                int value = Integer.parseInt(row.get(key).trim());
                if (key.equals("popularity") && (value < 0 || value > 100))
                    throw new IllegalArgumentException("popularity must be between 0 and 100");
                if (key.equals("duration_ms") && value < 0)
                    throw new IllegalArgumentException("duration_ms must be non-negative");
                track.put(key, value);
            }
            for (String key : DECIMALS) {
                double value = Double.parseDouble(row.get(key).trim());
                if (!Double.isFinite(value)) throw new IllegalArgumentException(key + " must be finite");
                if (UNIT_INTERVAL.contains(key) && (value < 0 || value > 1))
                    throw new IllegalArgumentException(key + " must be between 0 and 1");
                if (key.equals("tempo") && value < 0) throw new IllegalArgumentException("tempo must be non-negative");
                track.put(key, value);
            }
            String explicit = row.get("explicit").trim();
            if (!explicit.equalsIgnoreCase("true") && !explicit.equalsIgnoreCase("false"))
                throw new IllegalArgumentException("explicit must be true or false");
            track.put("explicit", Boolean.parseBoolean(explicit));
            return track;
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Invalid CSV record " + row.getRecordNumber() + ": " + e.getMessage(), e);
        }
    }

    public record ImportResult(long rowsProcessed, String message) {}
}
