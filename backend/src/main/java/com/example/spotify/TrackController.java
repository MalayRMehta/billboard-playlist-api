package com.example.spotify;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;
import java.io.IOException;
import java.util.*;

@RestController
@RequestMapping("/api")
public class TrackController {
    private final TrackStore store;
    private final CsvImportService importer;
    private final BillboardImportService billboardImporter;
    public TrackController(TrackStore store, CsvImportService importer,
                           BillboardImportService billboardImporter) {
        this.store = store; this.importer = importer; this.billboardImporter = billboardImporter;
    }

    @GetMapping("/health")
    public Map<String, String> health() { return Map.of("status", "UP", "catalogue", "Billboard"); }

    @PostMapping(value = "/tracks/import", consumes = "multipart/form-data")
    public CsvImportService.ImportResult load(@RequestParam("file") MultipartFile file) throws IOException {
        return importer.load(file);
    }

    @PostMapping(value = "/tracks/import-billboard", consumes = "multipart/form-data")
    public CsvImportService.ImportResult loadBillboard(@RequestParam("file") MultipartFile file) throws IOException {
        return billboardImporter.load(file);
    }

    @GetMapping("/tracks")
    public TrackStore.Page list(@RequestParam(defaultValue = "0") int page,
                               @RequestParam(defaultValue = "20") int size,
                               @RequestParam(required = false) String genre,
                               @RequestParam(required = false) String q) {
        if (page < 0 || size < 1 || size > 200)
            throw new IllegalArgumentException("page must be >= 0; size must be between 1 and 200");
        return store.list(page, size, genre, q);
    }

    @GetMapping("/tracks/{trackId}")
    public List<Map<String, Object>> track(@PathVariable String trackId) {
        var result = store.byTrackId(trackId);
        if (result.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Track not found");
        return result;
    }
}
