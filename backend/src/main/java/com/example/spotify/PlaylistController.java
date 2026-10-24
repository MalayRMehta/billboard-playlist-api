package com.example.spotify;

import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.client.*;
import java.util.Map;

/** Same-origin gateway: the browser never needs direct access to Python. */
@RestController
@RequestMapping("/api/playlists")
public class PlaylistController {
    private final RestClient ml;

    public PlaylistController(@Value("${ml.service.url:http://127.0.0.1:8001}") String url) {
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(5000);
        factory.setReadTimeout(120000);
        ml = RestClient.builder().baseUrl(url).requestFactory(factory).build();
    }

    public record Prompt(String prompt) {}

    @PostMapping("/candidates")
    public ResponseEntity<?> candidates(@RequestBody Prompt request) {
        String prompt = request.prompt() == null ? "" : request.prompt().strip();
        if (prompt.length() < 2 || prompt.length() > 240)
            throw new IllegalArgumentException("Describe your vibe using 2–240 characters.");
        try {
            return ResponseEntity.ok(ml.post().uri("/api/candidates")
                    .contentType(MediaType.APPLICATION_JSON).body(Map.of("prompt", prompt))
                    .retrieve().body(JsonNode.class));
        } catch (ResourceAccessException e) {
            return ResponseEntity.status(503).body(Map.of("detail",
                    "The lyric service is unavailable or still loading. Start Python on port 8001 and wait for startup to complete."));
        } catch (RestClientResponseException e) {
            return ResponseEntity.status(502).body(Map.of("detail",
                    "The lyric service could not rank songs. Check its terminal and the three lyric file paths."));
        }
    }
}
