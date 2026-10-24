package com.example.spotify;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import java.nio.charset.StandardCharsets;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = "spring.datasource.url=jdbc:h2:mem:spotify-test;DB_CLOSE_DELAY=-1")
@AutoConfigureMockMvc
class TrackApiTest {
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    private static final String HEADER = ",track_id,artists,album_name,track_name,popularity,duration_ms,explicit,danceability,energy,key,loudness,mode,speechiness,acousticness,instrumentalness,liveness,valence,tempo,time_signature,track_genre\n";
    private String row(int index, String id, String genre) {
        return index + "," + id + ",Artist,Album,\"Song, One\",55,200000,false,0.7,0.8,1,-6,1,0.05,0.1,0,0.2,0.6,120,4," + genre + "\n";
    }
    private MockMultipartFile file(String text) {
        return new MockMultipartFile("file", "dataset.csv", "text/csv", text.getBytes(StandardCharsets.UTF_8));
    }
    @BeforeEach void clean() { jdbc.update("DELETE FROM tracks"); }

    @Test void importsQuotedCsvWithIndexAndBom() throws Exception {
        mvc.perform(multipart("/api/tracks/import").file(file("\uFEFF" + HEADER + row(0,"a","pop"))))
                .andExpect(status().isOk()).andExpect(jsonPath("$.rowsProcessed").value(1));
        mvc.perform(get("/api/tracks/a")).andExpect(status().isOk())
                .andExpect(jsonPath("$[0].track_name").value("Song, One"))
                .andExpect(jsonPath("$[0].explicit").value(false))
                .andExpect(jsonPath("$[0].energy").value(0.8));
    }
    @Test void reimportIsIdempotentAndKeepsGenres() throws Exception {
        String csv = HEADER + row(0,"a","pop") + row(1,"a","rock");
        mvc.perform(multipart("/api/tracks/import").file(file(csv))).andExpect(status().isOk());
        mvc.perform(multipart("/api/tracks/import").file(file(csv))).andExpect(status().isOk());
        mvc.perform(get("/api/tracks")).andExpect(jsonPath("$.totalElements").value(2));
        mvc.perform(get("/api/tracks/a")).andExpect(jsonPath("$.length()").value(2));
    }
    @Test void listsWithPaginationAndSearchAndGenre() throws Exception {
        mvc.perform(multipart("/api/tracks/import").file(file(HEADER + row(0,"a","pop") + row(1,"b","rock"))))
                .andExpect(status().isOk());
        mvc.perform(get("/api/tracks").param("size","1").param("page","1"))
                .andExpect(jsonPath("$.items[0].track_id").value("b"))
                .andExpect(jsonPath("$.totalPages").value(2));
        mvc.perform(get("/api/tracks").param("q","SONG, ONE").param("genre","pop"))
                .andExpect(jsonPath("$.totalElements").value(1));
        mvc.perform(get("/api/tracks").param("q","' OR 1=1 --"))
                .andExpect(jsonPath("$.totalElements").value(0));
    }
    @Test void invalidRowRollsBackAlreadyFlushedBatch() throws Exception {
        var csv = new StringBuilder(HEADER);
        for (int i = 0; i < 500; i++) csv.append(row(i,"id" + i,"pop"));
        csv.append(row(500,"bad","pop").replace(",55,",",invalid,"));
        mvc.perform(multipart("/api/tracks/import").file(file(csv.toString())))
                .andExpect(status().isBadRequest());
        mvc.perform(get("/api/tracks")).andExpect(jsonPath("$.totalElements").value(0));
    }
    @Test void rejectsMissingColumnsEmptyFilesAndNonFiniteNumbers() throws Exception {
        mvc.perform(multipart("/api/tracks/import").file(file("track_id\na\n")))
                .andExpect(status().isBadRequest());
        mvc.perform(multipart("/api/tracks/import").file(file(""))).andExpect(status().isBadRequest());
        mvc.perform(multipart("/api/tracks/import").file(file(HEADER + row(0,"a","pop").replace("0.7", "NaN"))))
                .andExpect(status().isBadRequest());
    }
    @Test void validatesPaginationAndMissingTracks() throws Exception {
        mvc.perform(get("/api/tracks").param("size","201")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/tracks").param("page","-1")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/tracks").param("page","abc")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/tracks/unknown")).andExpect(status().isNotFound());
        mvc.perform(multipart("/api/tracks/import")).andExpect(status().isBadRequest());
    }
    @Test void missingLyricIdsDoNotCollapseDifferentBillboardSongs() throws Exception {
        String tsv = "Artist\tSong_Title\tBillboard_rank\tYear\tLyricID\n"
                + "Artist A\tSong A\t36\t1976\tNaN\n"
                + "Artist B\tSong B\t42\t1973\tNaN\n"
                + "Artist C\tSong C\t69\t1982\tNaN\n"
                + "Artist D\tSong D\t82\t1972\tNaN\n"
                + "Artist E\tSong E\t90\t1981\tNaN\n";
        jdbc.update("INSERT INTO tracks (track_id, genre, track_name, artists, payload) VALUES ('billboard-NaN', 'billboard', 'Legacy', 'Legacy', '{}')");
        for (int i = 0; i < 2; i++) {
            mvc.perform(multipart("/api/tracks/import-billboard").file(file(tsv)))
                    .andExpect(status().isOk()).andExpect(jsonPath("$.rowsProcessed").value(5));
            mvc.perform(get("/api/tracks")).andExpect(jsonPath("$.totalElements").value(5));
        }
        mvc.perform(get("/api/tracks/billboard-rank-36"))
                .andExpect(jsonPath("$[0].track_name").value("Song A"));
    }
}
