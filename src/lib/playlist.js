import { spotifyRequest } from './spotify.js';

export function normalise(text) {
  return String(text || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function titleKey(text) {
  return normalise(String(text).replace(/\s*[-–([]\s*(?:\d{4}\s+)?remaster(?:ed)?.*$/i, ''));
}
function artistScore(expected, actual) {
  const a = new Set(normalise(expected).split(' ').filter(t => !['and', 'the', 'feat', 'featuring', 'ft', 'with'].includes(t)));
  const b = new Set(normalise(actual).split(' ').filter(t => !['and', 'the', 'feat', 'featuring', 'ft', 'with'].includes(t)));
  if (!a.size || !b.size) return 0;
  const overlap = [...a].filter(t => b.has(t)).length;
  return overlap / b.size >= 0.85 ? overlap / a.size : 0;
}
export function chooseSpotifyTrack(candidate, items) {
  return items.filter(t => t?.uri?.startsWith('spotify:track:') && t.duration_ms > 0 &&
      t.is_playable !== false && !t.restrictions?.reason &&
      titleKey(t.name) === titleKey(candidate.title))
    .map(track => ({ track, score: artistScore(candidate.artists, track.artists.map(a => a.name).join(' ')) }))
    .filter(x => x.score >= 0.65).sort((a, b) => b.score - a.score)[0]?.track || null;
}

export async function rankCandidates(prompt) {
  let response;
  try {
    response = await fetch('/api/playlists/candidates', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }),
      signal: AbortSignal.timeout(130000) });
  } catch { throw new Error('Could not reach the playlist service. Check that Spring Boot and Python are running.'); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Could not rank songs. Check the Spring Boot and Python terminals.');
  if (!Array.isArray(body.candidates)) throw new Error('Unexpected API response. Use the updated backend included in this project.');
  return body;
}

// Per-tab cache only; disconnect/reload clears Spotify metadata.
const matches = new Map();
export function clearMatches() { matches.clear(); }
export async function resolveCandidates(candidates, onProgress = () => {}, request = spotifyRequest) {
  const resolved = [];
  let missing = 0;
  for (const [index, candidate] of candidates.entries()) {
    const key = JSON.stringify([candidate.title, candidate.artists]);
    let track;
    const cached = matches.get(key);
    if (cached && Date.now() - cached.created < 300000) track = cached.track;
    else {
      // Ten is Spotify's per-search result limit, NOT a Billboard candidate limit.
      const title = candidate.title.replaceAll('"', ' ').trim();
      const artist = candidate.artists.split(/\s+(?:&|feat\.?|featuring|with)\s+|;/i)[0].replaceAll('"', ' ').trim();
      const params = new URLSearchParams({ q: `track:${title} artist:${artist}`, type: 'track', limit: '10' });
      const body = await request(`/search?${params}`);
      track = chooseSpotifyTrack(candidate, body.tracks?.items || []);
      matches.set(key, { track, created: Date.now() });
    }
    if (track) resolved.push({ ...candidate, spotifyId: track.id, uri: track.uri,
      title: track.name, artists: track.artists.map(a => a.name).join(', '),
      durationMs: track.duration_ms, url: `https://open.spotify.com/track/${track.id}`,
      image: track.album?.images?.[0]?.url || null });
    else missing++;
    onProgress(index + 1, candidates.length);
  }
  return { tracks: resolved, missing };
}

export function fitPlaylist(tracks, minutes) {
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) throw new Error('Choose 1–240 whole minutes.');
  const budget = minutes * 60000;
  const used = new Set();
  let totalMs = 0;
  const selected = [];
  // Theme relevance takes priority; time is a hard upper bound. Keep milliseconds.
  for (const track of [...tracks].sort((a, b) => b.relevance - a.relevance)) {
    if (used.has(track.uri) || !Number.isFinite(track.durationMs) || track.durationMs <= 0 ||
        totalMs + track.durationMs > budget) continue;
    selected.push(track);
    used.add(track.uri);
    totalMs += track.durationMs;
    if (selected.length === 100) break;
  }
  return { tracks: selected, totalMs };
}
