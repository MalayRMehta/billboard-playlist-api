const config = import.meta.env || {};
const CLIENT_ID = config.VITE_SPOTIFY_CLIENT_ID || '';
const REDIRECT_URI = config.VITE_SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:5173/callback';
const TOKEN_KEY = 'vibetimer.spotify.tokens';
const AUTH_KEY = 'vibetimer.spotify.pkce';
let callbackPromise;
let refreshPromise;
let authGeneration = 0;

export const isConfigured = () => /^[a-zA-Z0-9]{32}$/.test(CLIENT_ID);
function stored(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; }
}
export const isConnected = () => Boolean(stored(TOKEN_KEY)?.access_token);
export const hasPlaybackScopes = () => {
  const scopes = new Set((stored(TOKEN_KEY)?.scope || '').split(/\s+/));
  return scopes.has('user-read-playback-state') && scopes.has('user-modify-playback-state');
};
export function disconnect() {
  authGeneration++;
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(AUTH_KEY);
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith('vibetimer.save.')) sessionStorage.removeItem(key);
  }
}
function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
export async function connect(forceConsent = false) {
  if (!isConfigured()) throw new Error('Add your Spotify Client ID to .env.local, then restart the webpage.');
  if (location.origin !== new URL(REDIRECT_URI).origin)
    throw new Error(`Open this app at ${new URL(REDIRECT_URI).origin} before connecting Spotify.`);
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(64)));
  const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  sessionStorage.setItem(AUTH_KEY, JSON.stringify({ verifier, state, created: Date.now() }));
  const params = new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: 'playlist-modify-private user-read-playback-state user-modify-playback-state', state,
    code_challenge_method: 'S256', code_challenge: challenge });
  if (forceConsent) params.set('show_dialog', 'true');
  location.assign(`https://accounts.spotify.com/authorize?${params}`);
}
async function tokenRequest(params, previous = null) {
  const generation = authGeneration;
  let response;
  try {
    response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CLIENT_ID, ...params }), signal: AbortSignal.timeout(30000),
    });
  } catch { throw new Error('Could not reach Spotify login. Check your connection and reconnect.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    if (generation === authGeneration) disconnect();
    throw new Error('Spotify login expired or was rejected. Connect Spotify again and check the callback URL.');
  }
  if (generation !== authGeneration) throw new Error('Spotify was disconnected.');
  const tokens = { ...data, scope: data.scope || previous?.scope || '',
    refresh_token: data.refresh_token || previous?.refresh_token,
    expires_at: Date.now() + Number(data.expires_in || 3600) * 1000 };
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
  return tokens.access_token;
}
export function finishLogin() {
  // React StrictMode mounts effects twice: exchange a one-use code only once.
  if (callbackPromise) return callbackPromise;
  callbackPromise = (async () => {
    const query = new URLSearchParams(location.search);
    if (!query.has('code') && !query.has('error')) return;
    const pending = stored(AUTH_KEY);
    const code = query.get('code');
    const error = query.get('error');
    history.replaceState({}, '', '/');
    sessionStorage.removeItem(AUTH_KEY);
    if (!pending || pending.state !== query.get('state') || Date.now() - pending.created > 600000)
      throw new Error('Spotify login could not be verified. Please connect again from this tab.');
    if (error || !code) throw new Error('Spotify permission was declined. You can connect again when ready.');
    await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
      code_verifier: pending.verifier });
  })();
  return callbackPromise;
}
async function accessToken(force = false) {
  const tokens = stored(TOKEN_KEY);
  if (!tokens) throw new Error('Connect Spotify first.');
  if (!force && tokens.expires_at > Date.now() + 60000) return tokens.access_token;
  if (!tokens.refresh_token) { disconnect(); throw new Error('Connect Spotify again.'); }
  if (!refreshPromise) {
    refreshPromise = tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token }, tokens)
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}
export async function spotifyRequest(path, options = {}, retry = true) {
  const token = await accessToken();
  let response;
  try {
    response = await fetch(`https://api.spotify.com/v1${path}`, {
      ...options, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30000),
    });
  } catch { throw new Error('Spotify could not be reached. Check your connection and try again.'); }
  if (response.status === 401 && retry) {
    await accessToken(true);
    return spotifyRequest(path, options, false);
  }
  if (response.status === 429) {
    const seconds = Math.max(1, Number(response.headers.get('Retry-After')) || 30);
    // Only replay reads automatically. Never duplicate a playlist creation.
    if (retry && (!options.method || options.method === 'GET') && seconds <= 15) {
      await new Promise(resolve => setTimeout(resolve, seconds * 1000));
      return spotifyRequest(path, options, false);
    }
    throw new Error(`Spotify is busy. Wait ${seconds} seconds before trying again.`);
  }
  if (response.status === 403)
    throw new Error('Spotify denied access. Check your app’s allowed users, permissions, and subscription.');
  if (!response.ok) throw new Error(`Spotify request failed (${response.status}). Please try again.`);
  if (response.status === 204) return null;
  return response.json();
}

export async function savePlaylist(tracks, prompt, targetMinutes) {
  if (!tracks.length || tracks.length > 100) throw new Error('Choose 1–100 tracks before saving.');
  // Keep a checkpoint so retrying an interrupted save reuses the playlist.
  const signature = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify([prompt, targetMinutes, tracks.map(t => t.uri)])))));
  const key = `vibetimer.save.${signature}`;
  let playlist = stored(key);
  if (!playlist) {
    playlist = await spotifyRequest('/me/playlists', { method: 'POST', body: JSON.stringify({
      name: `Beats Per Minute · ${prompt}`.slice(0, 100), public: false,
      description: `A ${targetMinutes}-minute session, matched from Spotify song lyrics.`,
    }) });
    sessionStorage.setItem(key, JSON.stringify(playlist));
  }
  try {
    // Replacing all items is idempotent if the first response was lost.
    await spotifyRequest(`/playlists/${encodeURIComponent(playlist.id)}/items`, {
      method: 'PUT', body: JSON.stringify({ uris: tracks.map(t => t.uri) }),
    });
  } catch (error) {
    throw new Error(`${error.message} The playlist was created; click Save again to finish adding songs.`);
  }
  return { id: playlist.id, url: `https://open.spotify.com/playlist/${playlist.id}` };
}

export async function startPlaylistPlayback(playlistId) {
  const { devices = [] } = await spotifyRequest('/me/player/devices');
  const device = devices.find(item => item.is_active && !item.is_restricted && item.id) ||
    devices.find(item => !item.is_restricted && item.id);
  if (!device) throw new Error('Open Spotify on a device, then try starting the timer again.');

  try {
    const query = new URLSearchParams({ device_id: device.id });
    await spotifyRequest(`/me/player/play?${query}`, {
      method: 'PUT', body: JSON.stringify({ context_uri: `spotify:playlist:${playlistId}` }),
    });
  } catch (error) {
    if (error.message.includes('Spotify denied access.'))
      throw new Error('Starting Spotify playback requires Premium and playback permission for this app.');
    if (error.message.includes('(404)'))
      throw new Error('Spotify could not start playback on that device. Open Spotify and try again.');
    throw error;
  }
}

export async function getCurrentlyPlaying() {
  return spotifyRequest('/me/player/currently-playing');
}
