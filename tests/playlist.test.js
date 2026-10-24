import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseSpotifyTrack, resolveCandidates, fitPlaylist, clearMatches, rankCandidates } from '../src/lib/playlist.js';
import { spotifyRequest, savePlaylist, disconnect, finishLogin } from '../src/lib/spotify.js';

const song = (id, durationMs = 180000, relevance = 1) => ({ uri: `spotify:track:${id}`, durationMs, relevance });
const item = (id, name = 'Dreams', artist = 'Fleetwood Mac') => ({ id, uri: `spotify:track:${id}`, name, artists: [{ name: artist }], duration_ms: 180000 });
const response = (body, status = 200, headers) => new Response(JSON.stringify(body), { status, headers });
const memory = new Map();
globalThis.sessionStorage = { getItem: k => memory.get(k), setItem: (k, v) => memory.set(k, v), removeItem: k => memory.delete(k) };
function login(expires = Date.now() + 3600000) {
  memory.set('vibetimer.spotify.tokens', JSON.stringify({ access_token: 'test-only', refresh_token: 'refresh-test', expires_at: expires }));
}

test('duration selection preserves relevance, skips long songs and rejects duplicate recordings', () => {
  const result = fitPlaylist([song('a', 200000, 3), song('b', 900000, 5), song('a', 200000, 2), song('c', 100000, 1)], 5);
  assert.deepEqual(result.tracks.map(t => t.uri), ['spotify:track:a', 'spotify:track:c']);
  assert.equal(result.totalMs, 300000);
});
test('milliseconds cannot accidentally exceed the timer budget', () => {
  assert.equal(fitPlaylist([song('a', 60001)], 1).tracks.length, 0);
  assert.throws(() => fitPlaylist([], 0), /1–240/);
});
test('song matching rejects covers, live versions, unplayable and wrong titles', () => {
  const expected = { title: 'Dreams', artists: 'Fleetwood Mac' };
  const correct = item('yes', 'Dreams - 2004 Remaster');
  assert.equal(chooseSpotifyTrack(expected, [item('cover', 'Dreams', 'Other Artist'), item('tribute', 'Dreams', 'Fleetwood Mac Tribute'), item('live', 'Dreams - Live'), correct]), correct);
  assert.equal(chooseSpotifyTrack(expected, [{ ...correct, is_playable: false }]), null);
});
test('all 100 candidates are resolved, with 10 results requested per song only', async () => {
  clearMatches(); let calls = 0;
  const candidates = Array.from({ length: 100 }, (_, i) => ({ title: `Song ${i}`, artists: 'Artist', relevance: 100 - i }));
  const result = await resolveCandidates(candidates, () => {}, async path => {
    assert.equal(new URL(`https://example.com${path}`).searchParams.get('limit'), '10');
    const i = calls++;
    return { tracks: { items: [item(`id${i}`, `Song ${i}`, 'Artist')] } };
  });
  assert.equal(calls, 100); assert.equal(result.tracks.length, 100);
});
test('upstream errors surface instead of returning a pretend playlist', async () => {
  globalThis.fetch = async () => response({ detail: 'Python is unavailable' }, 503);
  await assert.rejects(rankCandidates('rain'), /Python is unavailable/);
});
test('expired Spotify tokens refresh before the API request', async () => {
  login(0); const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push(url);
    if (url.includes('/api/token')) return response({ access_token: 'new-token', expires_in: 3600 });
    assert.equal(opts.headers.Authorization, 'Bearer new-token'); return response({ ok: true });
  };
  assert.deepEqual(await spotifyRequest('/search'), { ok: true }); assert.equal(calls.length, 2);
});
test('401 refreshes exactly once and preserves the request', async () => {
  login(); let attempts = 0;
  globalThis.fetch = async url => {
    if (url.includes('/api/token')) return response({ access_token: 'new-token', expires_in: 3600 });
    return attempts++ === 0 ? response({}, 401) : response({ ok: true });
  };
  assert.deepEqual(await spotifyRequest('/search'), { ok: true }); assert.equal(attempts, 2);
});
test('long Spotify rate limit is reported without hammering the API', async () => {
  login(); let calls = 0;
  globalThis.fetch = async () => { calls++; return response({}, 429, { 'Retry-After': '60' }); };
  await assert.rejects(spotifyRequest('/search'), /60 seconds/); assert.equal(calls, 1);
});
test('saving after an interrupted insert reuses the same private playlist', async () => {
  memory.clear(); login(); let creates = 0; let puts = 0;
  globalThis.fetch = async (url, opts) => {
    if (url.endsWith('/me/playlists')) {
      creates++; assert.equal(JSON.parse(opts.body).public, false);
      return response({ id: 'playlist123' });
    }
    assert.equal(opts.method, 'PUT'); assert.ok(url.endsWith('/playlist123/items'));
    assert.deepEqual(JSON.parse(opts.body).uris, ['spotify:track:a']);
    return ++puts === 1 ? response({}, 500) : response({ snapshot_id: 'done' });
  };
  await assert.rejects(savePlaylist([song('a')], 'rain', 30), /click Save again/);
  assert.equal((await savePlaylist([song('a')], 'rain', 30)).id, 'playlist123');
  assert.equal(creates, 1); assert.equal(puts, 2);
});
test('unverified OAuth callback is rejected before any token exchange', async () => {
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error('should not fetch'); };
  globalThis.location = { search: '?code=example&state=wrong' };
  globalThis.history = { replaceState() {} };
  memory.set('vibetimer.spotify.pkce', JSON.stringify({ state: 'expected', verifier: 'test', created: Date.now() }));
  await assert.rejects(finishLogin(), /could not be verified/); assert.equal(requests, 0);
  disconnect();
});
