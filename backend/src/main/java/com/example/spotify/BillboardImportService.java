package com.example.spotify;

import org.apache.commons.csv.CSVFormat;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import java.io.*;
import java.nio.charset.Charset;
import java.util.*;

@Service
public class BillboardImportService {
    private static final int ESTIMATED_DURATION_MS = 210_000;
    private final TrackStore store;

    public BillboardImportService(TrackStore store) { this.store = store; }

    @Transactional(rollbackFor = Exception.class)
    public CsvImportService.ImportResult load(MultipartFile file) throws IOException {
        if (file.isEmpty()) throw new IllegalArgumentException("Upload the Billboard all-time songs file.");
        try (var reader = new InputStreamReader(file.getInputStream(), Charset.forName("windows-1252"));
             var csv = CSVFormat.TDF.builder().setHeader().setSkipHeaderRecord(true).get().parse(reader)) {
            for (String required : List.of("Artist", "Song_Title", "Billboard_rank", "Year", "LyricID")) {
                if (!csv.getHeaderMap().containsKey(required))
                    throw new IllegalArgumentException("Missing Billboard column: " + required);
            }
            var batch = new ArrayList<Map<String, Object>>();
            long count = 0;
            for (var record : csv) {
                if (List.of("Artist", "Song_Title", "LyricID").stream()
                        .allMatch(field -> record.get(field).isBlank())) {
                    continue;
                }
                try {
                    String title = record.get("Song_Title").trim();
                    String artist = record.get("Artist").trim();
                    String lyricId = record.get("LyricID").trim();
                    if (title.isEmpty() || artist.isEmpty())
                        throw new IllegalArgumentException("Artist and song title are required");
                    int rank = Integer.parseInt(record.get("Billboard_rank").trim());
                    int year = Integer.parseInt(record.get("Year").trim());
                    boolean hasLyricId = lyricId.matches("[0-9]+");
                    var track = new LinkedHashMap<String, Object>();
                    track.put("track_id", hasLyricId ? "billboard-" + lyricId : "billboard-rank-" + rank);
                    track.put("track_genre", "billboard");
                    track.put("track_name", title);
                    track.put("artists", artist);
                    track.put("album_name", "");
                    track.put("popularity", Math.max(0, Math.min(100, 101 - rank)));
                    track.put("duration_ms", ESTIMATED_DURATION_MS);
                    track.put("explicit", false);
                    track.put("key", null);
                    track.put("year", year);
                    track.put("billboard_rank", rank);
                    track.put("lyric_id", hasLyricId ? lyricId : null);
                    batch.add(track);
                    count++;
                    if (batch.size() == 100) { store.upsert(batch); batch.clear(); }
                } catch (RuntimeException e) {
                    throw new IllegalArgumentException("Invalid Billboard row " + record.getRecordNumber()
                            + ": " + e.getMessage(), e);
                }
            }
            if (count == 0) throw new IllegalArgumentException("Billboard file has no songs.");
            if (!batch.isEmpty()) store.upsert(batch);
            // Migrate the shared key used by older builds for the missing-ID rows.
            store.removeLegacyMissingLyricId();
            return new CsvImportService.ImportResult(count,
                    "Imported Billboard songs. Each duration is an estimate of 210 seconds.");
        }
    }
}
