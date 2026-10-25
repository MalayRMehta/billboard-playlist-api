import { useEffect, useState } from 'react';
import { Timer, Music, Play, Square, Loader2, ExternalLink, Check } from 'lucide-react';
import { connect, disconnect, finishLogin, getCurrentlyPlaying, hasPlaybackScopes, isConnected, isConfigured, savePlaylist, startPlaylistPlayback } from './lib/spotify.js';
import { rankCandidates, resolveCandidates, fitPlaylist } from './lib/playlist.js';

function draft() {
  try { return JSON.parse(sessionStorage.getItem('vibetimer.form') || '{}'); } catch { return {}; }
}
function formatTime(seconds) {
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
}
function savedPickProbability() {
  const saved = draft().pickProbability;
  return [25, 50, 75, 100].includes(saved) ? saved : 50;
}

export default function App() {
  const [inputMinutes, setInputMinutes] = useState(() => draft().minutes || 40);
  const [inputVibe, setInputVibe] = useState(() => draft().prompt || '');
  const [pickProbability, setPickProbability] = useState(savedPickProbability);
  const [connected, setConnected] = useState(isConnected);
  const [playbackReady, setPlaybackReady] = useState(hasPlaybackScopes);
  const [nowPlaying, setNowPlaying] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(null);
  const [deadline, setDeadline] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    let alive = true;
    finishLogin().then(() => {
      if (alive) { setConnected(isConnected()); setPlaybackReady(hasPlaybackScopes()); }
    })
      .catch(e => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setAuthLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!connected || !playbackReady) { setNowPlaying(null); return; }
    let alive = true;
    const refresh = async () => {
      try {
        const data = await getCurrentlyPlaying();
        if (alive) setNowPlaying(data?.is_playing && data.item ? data.item : null);
      } catch { if (alive) setNowPlaying(null); }
    };
    refresh();
    const interval = setInterval(refresh, 20000);
    return () => { alive = false; clearInterval(interval); };
  }, [connected, playbackReady]);

  useEffect(() => {
    if (!deadline) return;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (!remaining) { setDeadline(null); setCompleted(true); }
    };
    update();
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [deadline]);

  async function handleConnect(forceConsent = false) {
    setError('');
    setBusy('connect');
    sessionStorage.setItem('vibetimer.form', JSON.stringify({ minutes: inputMinutes, prompt: inputVibe, pickProbability }));
    try { await connect(forceConsent); } catch (e) { setError(e.message); setBusy(''); }
  }

  async function generate(event) {
    event.preventDefault();
    const minutes = Number(inputMinutes);
    const prompt = inputVibe.trim();
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240 || prompt.length < 2 || prompt.length > 240) {
      setError('Choose 1–240 whole minutes and describe your vibe in 2–240 characters.'); return;
    }
    sessionStorage.setItem('vibetimer.form', JSON.stringify({ minutes, prompt, pickProbability: Number(pickProbability) }));
    setError(''); setBusy('generate'); setProgress('Matching your vibe against the catalogue…');
    setResult(null); setSaved(null); setCompleted(false);
    try {
      const ranked = await rankCandidates(prompt, minutes, Number(pickProbability));
      if (!ranked.candidates.length) throw new Error('No songs matched that theme. Try a few different words.');
      const resolved = await resolveCandidates(ranked.candidates, (done, total) => {
        setProgress(`Preparing tracks: ${done} of ${total}`);
      });
      const fitted = fitPlaylist(resolved.tracks, minutes);
      if (!fitted.tracks.length) throw new Error('No matching Spotify songs fit this time. Try a longer session or another theme.');
      setResult({ ...ranked, ...fitted, minutes, missing: resolved.missing });
    } catch (e) { setError(e.message); setConnected(isConnected()); }
    finally { setBusy(''); setProgress(''); }
  }

  async function save() {
    setBusy('save'); setError('');
    try { setSaved(await savePlaylist(result.tracks, result.prompt, result.minutes)); }
    catch (e) { setError(e.message); setConnected(isConnected()); }
    finally { setBusy(''); }
  }

  async function startSession() {
    setBusy('start'); setError('');
    try {
      const playlist = saved || await savePlaylist(result.tracks, result.prompt, result.minutes);
      setSaved(playlist);
      await startPlaylistPlayback(playlist.id);
      setNowPlaying(null);
      try {
        const current = await getCurrentlyPlaying();
        setNowPlaying(current?.is_playing && current.item ? current.item : null);
      } catch { /* The timer can still start if the track lookup fails. */ }
      setTimeLeft(result.minutes * 60);
      setDeadline(Date.now() + result.minutes * 60000);
      setCompleted(false);
    } catch (e) { setError(e.message); setConnected(isConnected()); setPlaybackReady(hasPlaybackScopes()); }
    finally { setBusy(''); }
  }

  const disabled = Boolean(busy) || authLoading;
  return (
    <main className="app-container">
      <div className="timer-card">
        <h1 className="app-title"><Timer size={32} className="icon-blue" /> Music Timer</h1>
        <p className="intro">A playlist for your mood. A little time for yourself.</p>
        <div className="connection">
          <span>{authLoading ? 'Checking Spotify…' : connected ? playbackReady ? 'Spotify connected' : 'Update Spotify permissions' : 'Connect your music'}</span>
          {connected && !playbackReady ? <button className="btn btn-spotify" disabled={disabled} onClick={() => handleConnect(true)}>Reconnect Spotify</button> :
            connected ? <button className="text-button" disabled={disabled || Boolean(deadline)} onClick={() => {
              disconnect(); setConnected(false); setPlaybackReady(false); setResult(null); setSaved(null);
            }}>Disconnect</button> : <button className="btn btn-spotify" disabled={disabled} onClick={handleConnect}>Connect Spotify</button>}
        </div>
        {!isConfigured() && <p className="notice">Setup: add your Spotify Client ID to .env.local and restart the webpage. Follow README.md.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        {deadline ? (
          <section className="countdown-panel" aria-label="Session timer">
            <div className="timer-digits" role="timer">{formatTime(timeLeft)}</div>
            <div className="current-vibe"><Music size={16} /><span>{result.prompt}</span></div>
            {connected && playbackReady && <div className="now-playing" aria-live="polite">
              {nowPlaying?.album?.images?.[0]?.url && <img src={nowPlaying.album.images[0].url} alt="" />}
              <div><span className="now-playing-label">Now playing</span>
                <strong>{nowPlaying ? nowPlaying.name : 'Nothing is playing'}</strong>
                {nowPlaying && <small>{nowPlaying.artists?.map(artist => artist.name).join(', ')}</small>}
              </div>
            </div>}
            <button className="btn btn-stop" onClick={() => { setDeadline(null); setTimeLeft(0); }}>Stop timer <Square size={14} /></button>
          </section>
        ) : (
          <form className="form-group" onSubmit={generate}>
            {completed && <p className="success" role="status">Your session is complete.</p>}
            <label className="input-label" htmlFor="minutes">How long do you need?</label>
            <div className="number-input-wrapper">
              <input id="minutes" type="number" min="1" max="240" step="1" required disabled={disabled}
                value={inputMinutes} onChange={e => setInputMinutes(e.target.value)} className="input-field number-input" />
              <span className="input-suffix">minutes</span>
            </div>
            <label className="input-label" htmlFor="vibe">Describe your mood / vibe</label>
            <input id="vibe" type="text" required minLength="2" maxLength="240" disabled={disabled}
              value={inputVibe} onChange={e => setInputVibe(e.target.value)}
              placeholder="e.g., rainy evening, love and nostalgia" className="input-field wide-input" />
            <label className="input-label" htmlFor="song-variety">How adventurous should the mix be?</label>
            <select id="song-variety" className="input-field wide-input" disabled={disabled}
              value={pickProbability} onChange={e => setPickProbability(Number(e.target.value))}
              aria-describedby="song-variety-help">
              <option value="25">Stay close to the theme</option>
              <option value="50">Balanced mix</option>
              <option value="75">Explore more</option>
              <option value="100">Maximum variety</option>
            </select>
            <small id="song-variety-help" className="notice">More adventurous mixes include songs less similar to your mood.</small>
            <button type="submit" disabled={disabled || !connected} className="btn btn-start">
              {busy === 'generate' ? <>Finding your songs <Loader2 size={18} className="spinner" /></> : <>Find my playlist <Music size={18} /></>}
            </button>
            {progress && <p className="notice" role="status">{progress}</p>}
          </form>
        )}
        {result && <section className="results" aria-label="Your playlist">
          <div className="result-heading"><h2>Your mix</h2><span>{result.tracks.length} songs · {formatTime(result.totalMs / 1000)}</span></div>
          <p className="notice">“{result.prompt}” · {result.minutes}-minute target. Searched {result.catalogTracks} catalogue songs.</p>
          {result.catalogTracks < 100 && <p className="notice">Only {result.catalogTracks} songs are loaded. Run the data loader and restart the API.</p>}
          {result.missing > 0 && <p className="notice">{result.missing} tracks did not have a usable dataset ID or duration.</p>}
          <ol className="track-list">{result.tracks.map(track => <li key={track.uri}>
            {track.image ? <img src={track.image} alt="" width="44" height="44" loading="lazy" /> : <Music size={28} aria-hidden="true" />}
            <div><a href={track.url} target="_blank" rel="noreferrer">{track.title}</a><small>{track.artists}</small></div>
            <span>{formatTime(track.durationMs / 1000)}</span>
          </li>)}</ol>
          {!saved ? <button className="btn btn-spotify full-width" onClick={save} disabled={disabled || !connected}>
            {busy === 'save' ? <>Saving… <Loader2 size={16} className="spinner" /></> : 'Save private playlist to Spotify'}
          </button> : <>
            <a className="saved-link" href={saved.url} target="_blank" rel="noreferrer"><Check size={16} /> Open playlist in Spotify <ExternalLink size={15} /></a>
            <iframe title="Your Spotify playlist" src={`https://open.spotify.com/embed/playlist/${saved.id}`}
              width="100%" height="352" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy" />
          </>}
          {!deadline && <button className="btn btn-start full-width start-timer" disabled={disabled || !connected || !playbackReady} onClick={startSession}>
            {busy === 'start' ? <>Starting playback… <Loader2 size={16} className="spinner" /></> : <>Play music & start {result.minutes}-minute timer <Play size={16} /></>}
          </button>}
        </section>}
      </div>
    </main>
  );
}
