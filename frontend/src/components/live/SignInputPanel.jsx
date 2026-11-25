import React, { useState, useRef, useEffect, useCallback } from 'react';
import Gestures from '@echoclass/shared/gestures';
import { SUPPORTED_GESTURES } from '@echoclass/shared/constants';
import { useHandTracker } from '../../hooks/useHandTracker';
import { Button } from '../common/Button';

const BY_ID = Object.fromEntries(SUPPORTED_GESTURES.map((g) => [g.id, g]));
const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];
const AUTO_SEND_MS = 2800;

const STATUS_TEXT = { off: 'Off', starting: 'Starting camera…', 'loading-model': 'Loading hand model (first time only)…', running: 'On', error: 'Unavailable' };
const PERMISSION_TEXT = { granted: 'Allowed', denied: 'Blocked', prompt: 'Will ask when you turn it on', unknown: 'Unknown (asked on use)' };

/**
 * Student input: REAL camera gestures (MediaPipe) when the camera and model are working, plus quick phrases and typing, which always work.
 * A message is labelled "sign" only when every word in it came from a camera-recognised pose.
 */
export function SignInputPanel({ onSend, onRequest, disabled = false, compact = false }) {
  const [buffer, setBuffer] = useState([]);              // [{ text, via: 'gesture' | 'phrase' | 'typed' }]
  const [auto, setAuto] = useState(true);
  const [typed, setTyped] = useState('');
  const bufRef = useRef(buffer); bufRef.current = buffer;
  const timer = useRef(null);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const items = bufRef.current;
    if (!items.length) return;
    const text = items.map((b) => b.text).join('. ').replace(/\.*$/, '.');
    const source = items.every((b) => b.via === 'gesture') ? 'sign' : 'student';
    setBuffer([]);
    onSend(text, source);
  }, [onSend]);

  const add = useCallback((text, via, request) => {
    setBuffer((b) => [...b, { text, via }]);
    if (request) onRequest?.(request);
  }, [onRequest]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (auto && buffer.length) timer.current = setTimeout(flush, AUTO_SEND_MS);
    return () => clearTimeout(timer.current);
  }, [buffer, auto, flush]);

  const onGesture = useCallback((id) => { const g = BY_ID[id]; if (g) add(g.phrase, 'gesture', g.request); }, [add]);
  const t = useHandTracker({ onGesture });

  const ev = t.evaluation;
  const current = ev?.gesture ? BY_ID[ev.gesture] : null;
  let handText = '–', signText = '–';
  if (t.running) {
    if (!t.hand) { handText = 'No hand in view'; signText = 'Waiting for a sign'; }
    else {
      handText = 'Hand detected';
      signText = ev.status === 'recognised' ? `${current.label} (${ev.clarity >= 0.5 ? 'clear' : 'fairly clear'}) – hold still`
        : ev.status === 'borderline' ? `Looks like ${current.label}, but unclear – adjust your hand`
        : ev.status === 'too_small' ? 'Hand too small – move closer'
        : 'Pose not in the supported list';
    }
  }

  const sendTyped = (e) => { e.preventDefault(); const v = typed.trim(); if (!v) return; setTyped(''); onSend(v, 'student'); };

  return (
    <section className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col gap-3" aria-labelledby="sign-h">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 id="sign-h" className="text-xs font-bold uppercase tracking-wider text-slate-300">Respond to the class</h3>
          <p className="text-[11px] text-slate-400">Hand tracking runs in your browser (MediaPipe). Video never leaves your device; only the words are shared.</p>
        </div>
        <Button variant={t.running ? 'danger' : 'secondary'} size="sm" onClick={t.running ? t.stop : t.start} disabled={disabled || t.status === 'starting' || t.status === 'loading-model'}>
          {t.running ? 'Turn off camera' : '📷 Turn on camera'}
        </Button>
      </div>

      {t.error && <div role="alert" className="text-xs rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 p-2">{t.error.message}</div>}

      <div className={`relative rounded-lg overflow-hidden border border-slate-800 bg-black aspect-video ${t.status === 'off' || t.status === 'error' ? 'hidden' : ''}`}>
        <video ref={t.videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover -scale-x-100" aria-label="Your camera preview" />
        <canvas ref={t.canvasRef} className="absolute inset-0 w-full h-full -scale-x-100 pointer-events-none" aria-hidden="true" />
        {t.progress > 0 && t.progress < 1 && <div className="absolute bottom-0 left-0 h-1 bg-emerald-400" style={{ width: `${Math.round(t.progress * 100)}%` }} />}
      </div>
      {/* The elements above must exist while the camera starts, so they are hidden with CSS rather than unmounted. */}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]" aria-label="Camera status">
        <dt className="text-slate-400">Permission</dt><dd>{PERMISSION_TEXT[t.permission] || t.permission}</dd>
        <dt className="text-slate-400">Camera</dt><dd>{STATUS_TEXT[t.status]}</dd>
        <dt className="text-slate-400">Hand model</dt><dd>{t.running ? `Ready (loaded from ${t.modelSource})` : t.status === 'error' && t.error?.code === 'model' ? 'Failed to load' : 'Not loaded'}</dd>
        <dt className="text-slate-400">Hand</dt><dd>{handText}</dd>
        <dt className="text-slate-400">Sign</dt><dd aria-live="polite">{signText}</dd>
      </dl>
      {t.running && (
        <div className="flex gap-1" aria-label="Fingers detected as extended">
          {FINGERS.map((f) => <span key={f} title={f} className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${t.fingers[f] ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300' : 'border-slate-700 text-slate-400'}`}>{f[0].toUpperCase()}</span>)}
        </div>
      )}

      <div aria-live="polite" className="rounded-lg bg-slate-950 border border-slate-800 p-2 min-h-[2.5rem] flex flex-wrap gap-1.5 items-center">
        {buffer.length === 0 && <span className="text-[11px] text-slate-400">Signs, phrases and typed words collect here, then send to the class.</span>}
        {buffer.map((b, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700">
            {b.via === 'gesture' ? '🤟 ' : ''}{b.text}
            <button type="button" aria-label={`Remove ${b.text}`} className="text-slate-400 hover:text-white" onClick={() => setBuffer((x) => x.filter((_, j) => j !== i))}>✕</button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={flush} disabled={disabled || !buffer.length}>Send now</Button>
        <Button size="sm" variant="ghost" onClick={() => setBuffer([])} disabled={!buffer.length}>Clear</Button>
        <label className="text-[11px] text-slate-300 flex items-center gap-1.5"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-send after 3 s</label>
      </div>

      <form onSubmit={sendTyped} className="flex gap-2">
        <label htmlFor="typed-msg" className="sr-only">Type a message to the class</label>
        <input id="typed-msg" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={300} disabled={disabled} placeholder="Type a message to the class…" className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100" />
        <Button type="submit" size="sm" disabled={disabled || !typed.trim()}>Send</Button>
      </form>

      {!compact && (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-300 font-semibold">Quick phrases (tap) and sign dictionary</summary>
          <p className="text-[11px] text-slate-400 mt-1 mb-2">These buttons are shortcuts, not gesture recognition. Tapping one adds its phrase exactly as if you had typed it.</p>
          <div className="grid grid-cols-2 gap-2">
            {SUPPORTED_GESTURES.map((g) => (
              <button key={g.id} type="button" disabled={disabled} onClick={() => add(g.phrase, 'phrase', g.request)} className="p-2 rounded-lg bg-slate-950 border border-slate-800 hover:border-emerald-500/50 text-left flex items-center gap-2">
                <span aria-hidden="true">{g.icon}</span><span className="min-w-0"><span className="block text-xs font-semibold truncate">{g.phrase}</span><span className="block text-[10px] text-slate-400 truncate">Pose: {g.label}</span></span>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">{Gestures.CONTEXT}</p>
        </details>
      )}
    </section>
  );
}
