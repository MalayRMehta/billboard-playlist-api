package com.example.spotify;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.util.*;

@Repository
public class TrackStore {
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public TrackStore(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
    }

    public void upsert(List<Map<String, Object>> tracks) {
        var args = tracks.stream().map(t -> new Object[]{t.get("track_id"),
                t.get("track_genre"), t.get("track_name"), t.get("artists"), encode(t)}).toList();
        jdbc.batchUpdate("MERGE INTO tracks (track_id, genre, track_name, artists, payload) "
                + "KEY(track_id, genre) VALUES (?, ?, ?, ?, ?)", args);
    }

    public List<Map<String, Object>> byTrackId(String trackId) {
        return jdbc.query("SELECT payload FROM tracks WHERE track_id = ? ORDER BY genre",
                (rs, n) -> decode(rs.getString(1)), trackId);
    }

    public void removeLegacyMissingLyricId() {
        jdbc.update("DELETE FROM tracks WHERE track_id = 'billboard-NaN' AND genre = 'billboard'");
    }

    public Page list(int page, int size, String genre, String q) {
        String where = " WHERE 1=1";
        var args = new ArrayList<Object>();
        if (genre != null && !genre.isBlank()) {
            where += " AND genre = ?";
            args.add(genre);
        }
        if (q != null && !q.isBlank()) {
            where += " AND (LOCATE(?, LOWER(track_name)) > 0 OR LOCATE(?, LOWER(artists)) > 0)";
            args.add(q.toLowerCase(Locale.ROOT));
            args.add(q.toLowerCase(Locale.ROOT));
        }
        long count = jdbc.queryForObject("SELECT COUNT(*) FROM tracks" + where, Long.class, args.toArray());
        args.add(size);
        args.add((long) page * size);
        var items = jdbc.query("SELECT payload FROM tracks" + where
                        + " ORDER BY track_id, genre LIMIT ? OFFSET ?",
                (rs, n) -> decode(rs.getString(1)), args.toArray());
        return new Page(items, page, size, count, (count + size - 1) / size);
    }

    private String encode(Map<String, Object> track) {
        try { return mapper.writeValueAsString(track); }
        catch (Exception e) { throw new IllegalStateException("Cannot encode track", e); }
    }

    private Map<String, Object> decode(String json) {
        try { return mapper.readValue(json, new TypeReference<Map<String, Object>>() {}); }
        catch (Exception e) { throw new IllegalStateException("Cannot decode track", e); }
    }

    public record Page(List<Map<String, Object>> items, int page, int size,
                       long totalElements, long totalPages) {}
}
