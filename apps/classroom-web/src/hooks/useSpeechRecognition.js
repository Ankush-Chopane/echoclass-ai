import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Browser speech recognition (Web Speech API: Chrome, Edge, Safari; not Firefox).
 * Unlike a naive auto-restart loop it: keeps callbacks in refs (so re-renders never recreate the recogniser),
 * stops on permission errors, retries network errors a few times, gives up if the engine restarts in a tight loop,
 * and drops a final result that repeats within 1.5 s (seen on Android Chrome).
 */
const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const speechSupported = Boolean(Recognition);

const MESSAGES = {
  'not-allowed': 'Microphone permission is blocked. Allow the microphone in the address bar, then press Start again.',
  'service-not-allowed': 'The browser’s speech service is not allowed on this page (it needs HTTPS or localhost).',
  'audio-capture': 'No microphone was found, or it is being used by another app.',
  'language-not-supported': 'This browser does not support that speaking language. Choose another.',
  network: 'The browser’s speech service could not be reached (it needs an internet connection).'
};

export function useSpeechRecognition({ lang = 'en-IN', onInterim, onFinal } = {}) {
  const [state, setState] = useState('off');      // off | starting | listening | retrying | blocked | error
  const [message, setMessage] = useState('');
  const cb = useRef({ onInterim, onFinal }); cb.current = { onInterim, onFinal };
  const rec = useRef(null);
  const want = useRef(false);
  const restarts = useRef([]);
  const netRetries = useRef(0);
  const lastFinal = useRef({ text: '', at: 0 });
  const langRef = useRef(lang); langRef.current = lang;

  const teardown = useCallback(() => {
    want.current = false;
    const r = rec.current; rec.current = null;
    if (r) { r.onend = r.onerror = r.onresult = r.onstart = null; try { r.abort(); } catch { /* not started */ } }
  }, []);

  const begin = useCallback(() => {
    if (!Recognition) return;
    const r = new Recognition();
    r.continuous = true; r.interimResults = true; r.lang = langRef.current; r.maxAlternatives = 1;
    r.onstart = () => { setState('listening'); setMessage(''); netRetries.current = 0; };
    r.onresult = (ev) => {
      let interim = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i], text = (res[0]?.transcript || '').trim();
        if (!text) continue;
        if (res.isFinal) {
          const now = Date.now();
          if (text === lastFinal.current.text && now - lastFinal.current.at < 1500) continue;
          lastFinal.current = { text, at: now };
          cb.current.onFinal?.(text);
        } else interim += (interim ? ' ' : '') + text;
      }
      cb.current.onInterim?.(interim);
    };
    r.onerror = (ev) => {
      if (ev.error === 'no-speech' || ev.error === 'aborted') return;       // normal pauses
      if (ev.error === 'network' && netRetries.current < 5) { netRetries.current += 1; setState('retrying'); setMessage(MESSAGES.network + ` Retrying (${netRetries.current}/5)…`); return; }
      want.current = false;
      setState(ev.error === 'not-allowed' || ev.error === 'service-not-allowed' ? 'blocked' : 'error');
      setMessage(MESSAGES[ev.error] || `Speech recognition stopped (${ev.error}).`);
    };
    r.onend = () => {
      cb.current.onInterim?.('');
      if (!want.current) { setState((s) => (s === 'blocked' || s === 'error' ? s : 'off')); return; }
      const now = Date.now();
      restarts.current = restarts.current.filter((t) => now - t < 15_000).concat(now);
      if (restarts.current.length > 6) { want.current = false; setState('error'); setMessage('Speech recognition keeps stopping, so it was switched off. Check the microphone, then press Start again.'); return; }
      setTimeout(() => { if (want.current && rec.current === r) { try { r.start(); } catch { setState('error'); setMessage('Could not restart speech recognition.'); want.current = false; } } }, netRetries.current ? 1500 : 250);
    };
    rec.current = r;
    try { r.start(); } catch (e) { want.current = false; setState('error'); setMessage('Could not start speech recognition: ' + e.message); }
  }, []);

  const start = useCallback(() => {
    if (!Recognition) { setState('error'); setMessage('This browser has no speech recognition. Use Chrome, Edge or Safari, or type captions.'); return; }
    teardown(); want.current = true; restarts.current = []; netRetries.current = 0; setState('starting'); setMessage(''); begin();
  }, [begin, teardown]);

  const stop = useCallback(() => { teardown(); setState('off'); setMessage(''); cb.current.onInterim?.(''); }, [teardown]);

  // Changing the language while listening restarts the recogniser with the new language.
  useEffect(() => { if (want.current) { teardown(); want.current = true; restarts.current = []; begin(); } }, [lang, begin, teardown]);
  useEffect(() => teardown, [teardown]);

  return { supported: speechSupported, state, message, listening: state === 'listening' || state === 'starting' || state === 'retrying', start, stop };
}
