export async function rankCandidates(prompt, targetMinutes) {
  let response;
  try {
    response = await fetch('/api/candidates', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, target_minutes: targetMinutes }),
      signal: AbortSignal.timeout(130000) });
  } catch { throw new Error('Could not reach the playlist service. Check that Python is running.'); }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : 'Could not rank songs. Check the Python service terminal.');
  if (!Array.isArray(body.candidates)) throw new Error('Unexpected API response. Use the updated backend included in this project.');
  return body;
}

export async function resolveCandidates(candidates, onProgress = () => {}) {
  const resolved = [];
  let missing = 0;
  for (const [index, candidate] of candidates.entries()) {
    const trackId = String(candidate.trackId || '').trim();
    if (trackId && Number(candidate.durationMs) > 0) {
      console.info('Using dataset Spotify track ID:', trackId);
      resolved.push({ ...candidate, uri: `spotify:track:${trackId}`,
        durationMs: Number(candidate.durationMs),
        url: `https://open.spotify.com/track/${trackId}`, image: null });
    } else missing++;
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
