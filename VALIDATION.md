# Validation for this package

## Passed

- React/Vite production build (`npm run build`).
- JavaScript lint (`npm run lint`), no warnings.
- 10 JavaScript tests (`npm test`): all 100 candidates processed, title/artist matching and cover rejection, duplicate recording removal, millisecond duration bounds, API failures, token refresh/401, rate limiting, interrupted playlist saves and OAuth state validation.
- 10 Java tests (`mvn package`): existing import/pagination checks, missing-LyricID regression and legacy-key cleanup, Spring-to-Python forwarding, invalid prompts and unavailable Python.
- Rebuilt executable Spring Boot JAR.
- Real HTTP integration using the bundled Billboard file, all three supplied lyric files and the pretrained `all-MiniLM-L6-v2` model. The catalogue contained **100 songs** and the lyric index matched **102 corpus records** (some songs have multiple versions).
- Real prompts sent through Spring Boot to Python:

| Prompt | Catalogue considered | Theme candidates |
| --- | ---: | ---: |
| rainy evening love | 100 | 57 |
| dancing happy party | 100 | 27 |
| lonely heartbreak | 100 | 39 |

These candidate counts come before Spotify availability checks and time fitting. They are not final playlist lengths.

## Still needs a live account/browser check

No user Spotify Client ID or account authorization was supplied. Spotify requests were tested with simulated responses and checked against the official API documentation. A real authorization, search, playlist save and playback have not been verified. Spotify permissions, account eligibility, market availability and rate limits can affect these steps.

A headless browser walkthrough was attempted, but Chromium could not launch in this restricted workspace (process startup failure). Browser rendering, callback navigation and the embedded player therefore need a manual check on your Mac. The Vite build and JavaScript tests passed, but they do not replace that check.

## Manual acceptance check on your Mac

1. Follow README.md. Confirm Java and Python health endpoints respond, with Python `catalogTracks` equal to 100.
2. Open `http://127.0.0.1:5173`, connect Spotify and verify it returns to VibeTimer.
3. Generate a 30-minute mix for `rainy evening love`. Confirm a real song list appears and its total duration is at most 30 minutes.
4. Save it, open the Spotify playlist and confirm its songs match the webpage.
5. Press Play in Spotify, start the timer, and verify Stop timer stops the countdown. Music is controlled separately.
6. Stop Python and generate again: the webpage should display an error and should not fabricate a playlist or start the timer.

Test environment: Java 17 and Node 24; model integration used Python 3.12 with CPU PyTorch and the existing runtime's numerical libraries. The Mac setup continues to recommend Python 3.11 and the project's pinned requirements.
