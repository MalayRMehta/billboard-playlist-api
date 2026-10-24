CREATE TABLE IF NOT EXISTS tracks (
    track_id VARCHAR(128) NOT NULL,
    genre VARCHAR(128) NOT NULL,
    track_name VARCHAR(4096) NOT NULL,
    artists VARCHAR(4096) NOT NULL,
    payload CLOB NOT NULL,
    PRIMARY KEY (track_id, genre)
);
CREATE INDEX IF NOT EXISTS tracks_genre_idx ON tracks(genre);
