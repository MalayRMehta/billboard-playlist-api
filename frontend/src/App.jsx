import { useEffect, useState } from 'react';
import { Music2, Play, Square, Shuffle, RotateCcw, Disc, Check, ExternalLink, Loader2 } from 'lucide-react';
import { connect, disconnect, finishLogin, getCurrentlyPlaying, hasPlaybackScopes, isConnected, isConfigured, savePlaylist, startPlaylistPlayback } from './lib/spotify.js';
import { rankCandidates, resolveCandidates, fitPlaylist } from './lib/playlist.js';

const VIBES = [
  'dreamy indie', 'disco party', 'main character energy', 'sunny afternoon',
  'lo-fi daydream', 'hyperpop chaos', 'cosy rainy day',
];

function draft() {
  try {
    const saved = JSON.parse(sessionStorage.getItem('vibetimer.form') || '{}');
    const migrationKey = 'vibetimer.variety-mapping-v2';
    if (!sessionStorage.getItem(migrationKey)) {
      const reversed = { 25: 100, 50: 75, 75: 50, 100: 25 };
      if (reversed[saved.pickProbability]) saved.pickProbability = reversed[saved.pickProbability];
      sessionStorage.setItem('vibetimer.form', JSON.stringify(saved));
      sessionStorage.setItem(migrationKey, 'true');
    }
    return saved;
  } catch { return {}; }
}

export default function App() {
  const [minutes, setMinutes] = useState(() => draft().minutes || 40);
  const [activity, setActivity] = useState(() => draft().activity || '');
  const [vibe, setVibe] = useState(() => draft().prompt || '');
  const [pickProbability, setPickProbability] = useState(() => [25, 50, 75, 100].includes(draft().pickProbability) ? draft().pickProbability : 75);
  const [connected, setConnected] = useState(isConnected);
  const [playbackReady, setPlaybackReady] = useState(hasPlaybackScopes);
  const [currentTrack, setCurrentTrack] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [deadline, setDeadline] = useState(null);
  const [completed, setCompleted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(null);

  useEffect(() => {
    let alive = true;
    finishLogin().then(() => {
      if (alive) { setConnected(isConnected()); setPlaybackReady(hasPlaybackScopes()); }
    }).catch((e) => { if (alive) setError(e.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!deadline) return undefined;
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining === 0) { setDeadline(null); setCompleted(true); }
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [deadline]);

  useEffect(() => {
    if (!deadline || !connected || !playbackReady) { setCurrentTrack(null); return undefined; }
    let alive = true;
    const refresh = async () => {
      try {
        const data = await getCurrentlyPlaying();
        const item = data?.is_playing ? data.item : null;
        const belongsToPlaylist = !result?.tracks?.length || result.tracks.some((track) => track.uri === item?.uri);
        if (alive && item && belongsToPlaylist) setCurrentTrack(item);
      } catch { /* Keep the playlist's first track visible if Spotify is slow to respond. */ }
    };
    refresh();
    const interval = setInterval(refresh, 20000);
    return () => { alive = false; clearInterval(interval); };
  }, [deadline, connected, playbackReady, result]);

  function persistForm(nextMinutes = minutes, nextVibe = vibe, nextActivity = activity, nextVariety = pickProbability) {
    sessionStorage.setItem('vibetimer.form', JSON.stringify({ minutes: nextMinutes, prompt: nextVibe, activity: nextActivity, pickProbability: nextVariety }));
  }

  async function handleConnect(forceConsent = false) {
    setError('');
    setBusy('connect');
    persistForm();
    try { await connect(forceConsent); }
    catch (e) { setError(e.message); setBusy(''); }
  }

  async function generate(event) {
    event?.preventDefault();
    const duration = Number(minutes);
    const mood = vibe.trim();
    const task = activity.trim();
    const prompt = task ? `${mood}, for ${task}` : mood;
    if (!Number.isInteger(duration) || duration < 1 || duration > 240 || mood.length < 2 || prompt.length > 240) {
      setError('Choose 1–240 whole minutes, describe your vibe in at least 2 characters, and keep the combined prompt under 240 characters.');
      return;
    }
    persistForm(duration, mood, task, Number(pickProbability));
    setError(''); setBusy('generate'); setLoading(true); setProgress('Matching your vibe against the catalogue…');
    setResult(null); setSaved(null); setCompleted(false);
    try {
      const ranked = await rankCandidates(prompt, duration, Number(pickProbability));
      if (!ranked.candidates.length) throw new Error('No songs matched that theme. Try a few different words.');
      const resolved = await resolveCandidates(ranked.candidates, (done, total) => setProgress(`Preparing tracks: ${done} of ${total}`));
      const fitted = fitPlaylist(resolved.tracks, duration);
      if (!fitted.tracks.length) throw new Error('No matching Spotify songs fit this time. Try a longer session or another theme.');
      setResult({ ...ranked, ...fitted, minutes: duration, activity: task, missing: resolved.missing });
    } catch (e) { setError(e.message); setConnected(isConnected()); }
    finally { setBusy(''); setLoading(false); setProgress(''); }
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
      const firstTrack = result.tracks[0];
      setCurrentTrack(firstTrack ? {
        uri: firstTrack.uri,
        name: firstTrack.title,
        artists: [{ name: firstTrack.artists }],
      } : null);
      setTimeLeft(result.minutes * 60);
      setDeadline(Date.now() + result.minutes * 60000);
      setCompleted(false);
    } catch (e) { setError(e.message); setConnected(isConnected()); setPlaybackReady(hasPlaybackScopes()); }
    finally { setBusy(''); }
  }

  function reset() {
    setDeadline(null); setCompleted(false); setTimeLeft(0); setCurrentTrack(null);
    setResult(null); setSaved(null); setError(''); setProgress('');
  }

  function randomVibe() {
    const choices = VIBES.filter((option) => option !== vibe);
    setVibe(choices[Math.floor(Math.random() * choices.length)] || VIBES[0]);
  }

  const formatTime = (seconds) => {
    const wholeSeconds = Math.floor(seconds);
    return `${String(Math.floor(wholeSeconds / 60)).padStart(2, '0')}:${String(wholeSeconds % 60).padStart(2, '0')}`;
  };
  const progressPercent = Math.min(100, (timeLeft / (Math.max(1, Number(result?.minutes || minutes)) * 60)) * 100);
  const disabled = Boolean(busy) || loading;

  return (
    <main className="app-container">
      <div className="blob blob-pink" />
      <div className="blob blob-yellow" />
      <div className="blob blob-blue" />
      <span className="doodle doodle-one" aria-hidden="true">✳</span>
      <span className="doodle doodle-two" aria-hidden="true">✦</span>
      <span className="doodle doodle-three" aria-hidden="true">♫</span>
      <span className="doodle doodle-four" aria-hidden="true">♥</span>

      <section className="timer-card">
        <header className="brand">
          <span className="brand-icon"><Music2 size={21} /></span>
          BPM<span className="brand-star">✳</span>
        </header>

        <div className="connection-bar">
          <span className={`connection-status${connected ? ' is-connected' : ''}`}>
            <span className="status-dot" />
            {connected ? playbackReady ? 'Spotify connected' : 'Spotify permissions needed' : 'Connect your Spotify'}
          </span>
          {connected ? <button className="connection-button" disabled={disabled || Boolean(deadline)} onClick={() => handleConnect(true)}>
            {playbackReady ? 'Reconnect' : 'Update access'}
          </button> : <button className="connection-button" disabled={disabled || Boolean(deadline)} onClick={() => handleConnect()}>
            {busy === 'connect' ? 'Connecting…' : 'Connect'}
          </button>}
          {connected && <button className="connection-disconnect" disabled={disabled || Boolean(deadline)} onClick={() => {
            disconnect(); setConnected(false); setPlaybackReady(false); setResult(null); setSaved(null); setCurrentTrack(null);
          }}>Disconnect</button>}
        </div>

        {!isConfigured() && <p className="setup-notice">Add your Spotify Client ID to <code>frontend/.env.local</code> and restart the webpage.</p>}
        {error && <p className="app-error" role="alert">{error}</p>}

        {!deadline && !completed ? (
          <div className="setup">
            <h1>Find your<br /><span>flow state.</span></h1>

            <div className="duration">
              <button className="minute-adjust" disabled={disabled} onClick={() => setMinutes((m) => Math.max(1, Number(m || 1) - 5))} aria-label="Subtract five minutes">−</button>
              <input aria-label="Session length in minutes" type="number" min="1" max="240" value={minutes} disabled={disabled}
                onChange={(e) => setMinutes(e.target.value === '' ? '' : Math.min(240, Math.max(1, Number(e.target.value))))}
                onBlur={() => { if (!minutes || Number(minutes) < 1) setMinutes(40); }} />
              <span className="minute-label">MIN</span>
              <button className="minute-adjust" disabled={disabled} onClick={() => setMinutes((m) => Math.min(240, Number(m || 0) + 5))} aria-label="Add five minutes">+</button>
            </div>

            <div className="activity-input">
              <label htmlFor="activity">WHAT ARE YOU DOING?</label>
              <input id="activity" type="text" value={activity} disabled={disabled} maxLength={100}
                onChange={(e) => setActivity(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && generate(e)}
                placeholder="e.g. studying, drawing..." />
            </div>

            <div className="vibe-input">
              <Music2 size={19} aria-hidden="true" />
              <input aria-label="Describe your music vibe" value={vibe} disabled={disabled} maxLength={140}
                onChange={(e) => setVibe(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && generate(e)}
                placeholder="What's the vibe?" />
              <button type="button" onClick={randomVibe} disabled={disabled} aria-label="Random vibe" title="Surprise me"><Shuffle size={17} /></button>
            </div>

            <div className="variety-input">
              <label htmlFor="song-variety">HOW ADVENTUROUS?</label>
              <select id="song-variety" value={pickProbability} disabled={disabled} onChange={(e) => setPickProbability(Number(e.target.value))}>
                <option value="100">Stay close to the theme</option>
                <option value="75">Balanced mix</option>
                <option value="50">Explore more</option>
                <option value="25">Maximum variety</option>
              </select>
            </div>

            <button className="start-button" onClick={generate} disabled={disabled || !connected}>
              {busy === 'generate' ? <>{progress || 'Making magic...'} <Loader2 size={17} className="loading-icon" /></> : <>Let’s go! <span className="play-icon"><Play size={17} fill="currentColor" /></span></>}
            </button>

            {result && <section className="results-panel" aria-label="Generated playlist">
              <div className="results-heading"><strong>Your mix</strong><span>{result.tracks.length} tracks · {formatTime(result.totalMs / 1000)}</span></div>
              <p className="results-prompt">“{result.prompt}” · {result.minutes} min</p>
              <ol className="generated-tracks">{result.tracks.map((track) => <li key={track.uri}>
                {track.image ? <img src={track.image} alt="" width="34" height="34" loading="lazy" /> : <Music2 size={22} aria-hidden="true" />}
                <div><a href={track.url} target="_blank" rel="noreferrer">{track.title}</a><small>{track.artists}</small></div>
                <span>{formatTime(track.durationMs / 1000)}</span>
              </li>)}</ol>
              {result.missing > 0 && <p className="results-prompt">{result.missing} tracks lacked a usable Spotify ID or duration.</p>}
              {!saved ? <button className="save-button" onClick={save} disabled={disabled || !connected}>
                {busy === 'save' ? <>Saving… <Loader2 size={15} className="loading-icon" /></> : 'Save private playlist'}
              </button> : <a className="playlist-link" href={saved.url} target="_blank" rel="noreferrer"><Check size={14} /> Open playlist in Spotify <ExternalLink size={14} /></a>}
              <button className="start-button play-session-button" onClick={startSession} disabled={disabled || !connected || !playbackReady}>
                {busy === 'start' ? <>Starting playback… <Loader2 size={15} className="loading-icon" /></> : <>Play music & start timer <Play size={15} fill="currentColor" /></>}
              </button>
            </section>}
          </div>
        ) : deadline ? (
          <div className="active">
            <div className="timer-ring" style={{ '--progress': `${progressPercent}%` }}>
              <div className="timer-inner">
                <span className="tiny-label">YOUR TIME</span>
                <div className="digits">{formatTime(timeLeft)}</div>
                <span className="tiny-vibe">✦ JUST KEEP VIBING ✦</span>
              </div>
            </div>
            {(result?.activity || activity) && <p className="activity-display">{result?.activity || activity}</p>}

            {connected && playbackReady && <div className="now-playing-card" aria-live="polite">
              <div className="now-playing-icon"><Disc size={20} className={currentTrack ? 'spin-slow' : ''} /></div>
              <div className="now-playing-info">
                <span className="now-playing-label">NOW PLAYING</span>
                <p className="track-title">{currentTrack?.name || 'Nothing is playing'}</p>
                <p className="track-artist">{currentTrack?.artists?.map((artist) => artist.name).join(', ') || 'Your Spotify session'}</p>
              </div>
            </div>}

            {saved && <a className="playlist-link" href={saved.url} target="_blank" rel="noreferrer">Open playlist ↗</a>}
            <button className="stop-button" onClick={() => { setDeadline(null); setTimeLeft(0); setCurrentTrack(null); }}><Square size={13} fill="currentColor" /> Stop</button>
          </div>
        ) : (
          <div className="finished">
            <div className="party-emoji">🎉</div>
            <h1>You did it<span>!</span></h1>
            <p>Look at you go ✨</p>
            {(result?.activity || activity) && <p className="activity-display">{result?.activity || activity} complete!</p>}
            {saved && <a className="playlist-link" href={saved.url} target="_blank" rel="noreferrer">Keep the music going ↗</a>}
            <button className="start-button" onClick={reset}>Again? <span className="play-icon"><RotateCcw size={17} /></span></button>
          </div>
        )}

        <footer>MADE OF MUSIC &amp; MAGIC <span>♥</span></footer>
      </section>
    </main>
  );
}
