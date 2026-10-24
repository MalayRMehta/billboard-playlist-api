package com.example.spotify;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class PlaylistApiTest {
    HttpServer server;
    MockMvc mvc;
    AtomicReference<String> received = new AtomicReference<>();
    @BeforeEach void setup() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/candidates", exchange -> {
            received.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] json = "{\"catalogTracks\":100,\"candidates\":[],\"expandedTerms\":[\"rain\"]}".getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, json.length);
            exchange.getResponseBody().write(json); exchange.close();
        });
        server.start();
        mvc = MockMvcBuilders.standaloneSetup(new PlaylistController("http://127.0.0.1:" + server.getAddress().getPort()))
                .setControllerAdvice(new ApiErrors()).build();
    }
    @AfterEach void stop() { server.stop(0); }
    @Test void forwardsPromptAndRetainsFullCatalogueCount() throws Exception {
        mvc.perform(post("/api/playlists/candidates").contentType("application/json").content("{\"prompt\":\" rainy evening \"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.catalogTracks").value(100));
        assertEquals("{\"prompt\":\"rainy evening\"}", received.get());
    }
    @Test void rejectsBlankAndMissingPrompts() throws Exception {
        for (String json : new String[]{"{}", "{\"prompt\":\"  \"}"})
            mvc.perform(post("/api/playlists/candidates").contentType("application/json").content(json)).andExpect(status().isBadRequest());
        assertNull(received.get());
    }
    @Test void unavailablePythonHasActionableError() throws Exception {
        server.stop(0);
        mvc.perform(post("/api/playlists/candidates").contentType("application/json").content("{\"prompt\":\"rain\"}"))
                .andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.detail").value(org.hamcrest.Matchers.containsString("port 8001")));
    }
}
