import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useAccessibility } from '../hooks/useAccessibility';
import { useWebSocket } from '../hooks/useWebSocket';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useOfflineSpeech } from '../hooks/useOfflineSpeech';
import { api } from '../services/api';
import { Button } from '../components/common/Button';
import { Modal } from '../components/common/Modal';
import { StatusBadge, LoadingIndicator } from '../components/common/StatusBadge';
import { SignInputPanel } from '../components/live/SignInputPanel';
import { SUPPORTED_LANGUAGES, REQUEST_BUTTONS } from '@echoclass/shared/constants';

const CONNECTION = {
  connecting: ['warning', 'CONNECTING…'], connected: ['live', 'LIVE'], reconnecting: ['warning', 'RECONNECTING…'], ended: ['ended', 'ENDED'], failed: ['ended', 'DISCONNECTED']
};
const NOTICES = {
  rate_limited: 'You are sending too fast. Slow down a little.',
  offline_speech_unavailable: 'The offline speech engine is not installed on this server, so nothing is being recognised. Switch to browser speech or type captions.',
  offline_speech_busy: 'Another class is already using the offline speech engine. Switch to browser speech for now.',
  bad_audio: 'The server rejected the audio it received.',
  bad_caption: 'That message was rejected by the server.'
};
const ENGINE_STATE = { off: 'Microphone off', starting: 'Starting microphone…', listening: 'Listening', retrying: 'Reconnecting speech service…', blocked: 'Microphone blocked', error: 'Speech stopped' };

export function LiveClassroomPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isTeacher } = useAuth();
  const { captionSize } = useAccessibility();

  const [classroom, setClassroom] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [config, setConfig] = useState(null);

  const [language, setLanguage] = useState('en-IN');
  const [engine, setEngine] = useState('browser');             // browser | offline
  const [typed, setTyped] = useState('');
  const [localInterim, setLocalInterim] = useState('');
  const [flash, setFlash] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const cooldown = useRef({});
  const scroller = useRef(null);
  const stick = useRef(true);

  // 1) Find the live session of this classroom. GET /classrooms/:id returns { ...classroom, live: { id, title } | null }.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cls, cfg] = await Promise.all([api.getClassroom(id), api.getConfig()]);
        if (cancelled) return;
        setClassroom(cls); setConfig(cfg); setLanguage(cls.language || 'en-IN');
        if (cls.live) setSessionId(cls.live.id); else setLoadError('There is no live lecture in this classroom right now.');
      } catch (e) { if (!cancelled) setLoadError(e.message); }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const ws = useWebSocket(sessionId);
  const { captions, interim, presence, flags, requests, status, notice, failure, sendCaption, sendFlag, sendRequest, sendRaw } = ws;

  // When the lecture ends (teacher pressed End, or it ended elsewhere) everyone is taken to the saved transcript.
  useEffect(() => { if (status === 'ended' && sessionId) { const t = setTimeout(() => navigate(`/transcripts/${sessionId}`, { replace: true }), 1500); return () => clearTimeout(t); } return undefined; }, [status, sessionId, navigate]);

  // 2) Teacher speech: browser engine (Web Speech API) or the server's offline Vosk engine.
  const browserMic = useSpeechRecognition({
    lang: language,
    onInterim: (t) => { setLocalInterim(t); if (t) sendCaption({ text: t.slice(-500), final: false, source: 'speech' }); },
    onFinal: (t) => { setLocalInterim(''); if (!sendCaption({ text: t, final: true, source: 'speech' })) setFlash('Too many unsent captions; check your connection.'); }
  });
  const offlineAvailable = Boolean(config?.offlineSpeech?.available);
  const offlineMic = useOfflineSpeech({ send: sendRaw, available: offlineAvailable });
  const mic = engine === 'offline' ? offlineMic : browserMic;
  const micOn = mic.listening;
  const stopAll = useCallback(() => { browserMic.stop(); offlineMic.stop(); }, [browserMic, offlineMic]);

  useEffect(() => {
    if (!isTeacher) return undefined;
    const warn = (e) => { if (micOn) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isTeacher, micOn]);
  useEffect(() => { if (status === 'ended' || status === 'failed') stopAll(); }, [status, stopAll]);

  // 3) Auto-scroll only while the reader is at the bottom (never yank the view away from someone re-reading).
  useEffect(() => { const el = scroller.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [captions, interim, localInterim]);
  const onScroll = () => { const el = scroller.current; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; };

  const sendTyped = (e) => { e.preventDefault(); const t = typed.trim(); if (!t) return; if (sendCaption({ text: t, final: true, source: 'typed' })) setTyped(''); };
  const studentSend = useCallback((text, source) => { if (!sendCaption({ text, final: true, source })) setFlash('Could not send: too many messages waiting. Check your connection.'); else if (!ws.connected) setFlash('You are offline; your message will be sent when you reconnect.'); }, [sendCaption, ws.connected]);
  const request = useCallback((kind, label) => {
    const now = Date.now();
    if (cooldown.current[kind] && now - cooldown.current[kind] < 3000) { setFlash('Please wait a moment before sending that again.'); return; }
    cooldown.current[kind] = now;
    setFlash(sendRequest(kind) ? `Sent to your teacher: ${label || kind}` : 'You are offline. Try again when reconnected.');
  }, [sendRequest]);
  const flag = (cap, kind) => setFlash(sendFlag(cap.id, kind) ? (kind === 'confusing' ? 'Marked as confusing. Your teacher will see it.' : 'Marked as important.') : 'You are offline. Try again when reconnected.');

  async function endLecture() {
    setEnding(true);
    try { stopAll(); await api.endSession(sessionId); navigate(`/transcripts/${sessionId}`); }
    catch (e) { setFlash(e.message); setEnding(false); setConfirmEnd(false); }
  }

  if (loadError) {
    return (
      <div className="max-w-xl mx-auto mt-10 p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center" role="alert">
        <p className="text-slate-200 mb-4">{loadError}</p>
        <Link to={`/classrooms/${id}`}><Button variant="secondary">← Back to classroom</Button></Link>
      </div>
    );
  }
  if (!classroom || !sessionId) return <LoadingIndicator text="Opening the live classroom…" />;

  const [badgeStatus, badgeLabel] = CONNECTION[status] || CONNECTION.connecting;
  const lectureTitle = ws.session?.title || classroom.live?.title || classroom.name;
  const readOnly = status === 'ended' || status === 'failed';

  return (
    <div className="flex flex-col gap-4">
      <header className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <StatusBadge status={badgeStatus} label={badgeLabel} />
          <div>
            <Link to={`/classrooms/${id}`} className="text-[11px] text-slate-400 hover:text-white">← {classroom.name}</Link>
            <h1 className="text-base font-bold text-white leading-tight">{lectureTitle}</h1>
            <p className="text-xs text-slate-400" aria-live="polite">{presence.length} {presence.length === 1 ? 'person' : 'people'} in the room</p>
          </div>
        </div>
        {isTeacher
          ? <Button variant="danger" size="sm" onClick={() => setConfirmEnd(true)} disabled={readOnly}>■ End lecture and save transcript</Button>
          : <Button variant="secondary" size="sm" onClick={() => navigate(`/classrooms/${id}`)}>Leave class</Button>}
      </header>

      <div className="sr-only" role="status" aria-live="polite">{`Connection: ${badgeLabel}`}</div>
      {failure && <div role="alert" className="p-3 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm">{failure}</div>}
      {status === 'ended' && <div role="status" className="p-3 rounded-lg border border-slate-700 bg-slate-900 text-sm">This lecture has ended. Opening the transcript…</div>}
      {status === 'reconnecting' && <div role="status" className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm">Connection lost. Reconnecting… {isTeacher ? 'Captions you speak meanwhile are kept and sent when the connection returns.' : ''}</div>}
      {notice && NOTICES[notice] && <div role="alert" className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm">{NOTICES[notice]}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* captions */}
        <section className="lg:col-span-2 flex flex-col bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden h-[60vh] lg:h-[calc(100vh-14rem)] min-h-[320px]" aria-label="Live captions">
          <div className="p-3 border-b border-slate-800 bg-slate-900/50 flex justify-between text-xs text-slate-400">
            <span>💬 Live captions</span><span>Text size: {captionSize}px (change under Display)</span>
          </div>
          <div ref={scroller} onScroll={onScroll} className="flex-1 overflow-y-auto p-4 space-y-3" role="log" aria-live="off" tabIndex={0} aria-label="Caption history">
            {captions.length === 0 && !interim && !localInterim && (
              <p className="h-full flex items-center justify-center text-slate-400 text-sm italic text-center px-6">
                {isTeacher ? 'Press “Start microphone” and begin teaching, or type a caption. Students see your words here as you speak.' : 'Waiting for the teacher to speak. Captions will appear here.'}
              </p>
            )}
            {captions.map((cap) => {
              const f = flags[cap.id] || {};
              return (
                <article key={cap.id} className="p-3 rounded-xl bg-slate-900/50 border border-slate-800">
                  <div className="flex items-center justify-between gap-2 text-xs text-slate-400 mb-1">
                    <span className="font-bold flex items-center gap-1.5">
                      <span aria-hidden="true">{cap.source === 'sign' ? '🤟' : cap.source === 'student' ? '✍️' : cap.source === 'typed' ? '⌨️' : '🎙️'}</span>
                      {cap.speaker}
                      <span className="text-[10px] uppercase font-mono px-1 rounded bg-slate-800 text-slate-300">{cap.source === 'sign' ? 'sign (camera)' : cap.source}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      {isTeacher ? (<>
                        {f.confusing > 0 && <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40">❓ {f.confusing} confused</span>}
                        {f.important > 0 && <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">⭐ {f.important}</span>}
                      </>) : (<>
                        <button type="button" onClick={() => flag(cap, 'confusing')} disabled={readOnly} aria-label={`Mark “${cap.text.slice(0, 40)}” as confusing`} className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${f.confusing ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'}`}>❓ {f.confusing || 'Confusing'}</button>
                        <button type="button" onClick={() => flag(cap, 'important')} disabled={readOnly} aria-label={`Mark “${cap.text.slice(0, 40)}” as important`} className={`px-2 py-0.5 rounded text-[11px] font-semibold border ${f.important ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'}`}>⭐ {f.important || 'Important'}</button>
                      </>)}
                    </span>
                  </div>
                  <p style={{ fontSize: `${captionSize}px`, lineHeight: 1.35 }} className="font-medium text-slate-100">{cap.text}</p>
                </article>
              );
            })}
            {(localInterim || interim) && (
              <div className="p-3 rounded-xl border-2 border-dashed border-emerald-500/40 bg-emerald-950/20" aria-hidden="true">
                <span className="text-xs text-emerald-400 font-semibold block mb-1">{localInterim ? 'You (still recognising…)' : `${interim.speaker} (still recognising…)`}</span>
                <p style={{ fontSize: `${captionSize}px`, lineHeight: 1.35 }} className="italic text-emerald-200">{localInterim || interim.text}</p>
              </div>
            )}
          </div>
          <p className="px-4 py-2 text-[11px] text-slate-400 border-t border-slate-800">Dashed italic lines are still being recognised and may change. Finished lines are saved to the transcript.</p>
        </section>

        {/* side panel */}
        <div className="flex flex-col gap-4">
          {isTeacher ? (
            <>
              <section className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col gap-3" aria-labelledby="mic-h">
                <h2 id="mic-h" className="text-xs font-bold uppercase tracking-wider text-slate-300">Teacher microphone</h2>
                <div className="flex items-center gap-3">
                  <Button variant={micOn ? 'danger' : 'primary'} onClick={micOn ? mic.stop : mic.start} aria-pressed={micOn} disabled={readOnly || (engine === 'browser' && !browserMic.supported)}>
                    {micOn ? '■ Stop microphone' : '🎙 Start microphone'}
                  </Button>
                  <span className="text-xs" role="status" aria-live="polite">{engine === 'browser' ? ENGINE_STATE[browserMic.state] : (offlineMic.state === 'listening' ? 'Listening (offline engine)' : offlineMic.state === 'starting' ? 'Starting microphone…' : offlineMic.state === 'error' ? 'Offline engine stopped' : 'Microphone off')}</span>
                </div>
                {mic.message && <p role="alert" className="text-xs text-amber-300">{mic.message}</p>}
                {engine === 'browser' && !browserMic.supported && <p className="text-xs text-amber-300">This browser has no speech recognition (Firefox). Use Chrome, Edge or Safari, choose the offline engine, or type captions below.</p>}

                <div>
                  <label htmlFor="engine" className="text-xs text-slate-400 block mb-1">Speech engine</label>
                  <select id="engine" value={engine} disabled={micOn} onChange={(e) => setEngine(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200">
                    <option value="browser">Browser speech recognition (needs internet in most browsers)</option>
                    <option value="offline" disabled={!offlineAvailable}>Offline engine (Vosk on this server){offlineAvailable ? '' : ' – not installed'}</option>
                  </select>
                  {!offlineAvailable && <p className="text-[11px] text-slate-400 mt-1">To enable offline recognition: <code>pip install vosk</code> then <code>npm run fetch-speech-model</code>, and restart the server.</p>}
                </div>
                {engine === 'browser' && (
                  <div>
                    <label htmlFor="lang" className="text-xs text-slate-400 block mb-1">Speaking language</label>
                    <select id="lang" value={language} onChange={(e) => setLanguage(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-xs text-slate-200">
                      {SUPPORTED_LANGUAGES.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                    </select>
                  </div>
                )}
                <form onSubmit={sendTyped} className="flex gap-2">
                  <label htmlFor="typed-caption" className="sr-only">Type a caption</label>
                  <input id="typed-caption" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={300} disabled={readOnly} placeholder="Type a caption (e.g. [bell rings])" className="flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-100" />
                  <Button type="submit" size="sm" disabled={readOnly || !typed.trim()}>Send</Button>
                </form>
              </section>

              <section className="p-4 rounded-xl bg-slate-900 border border-slate-800" aria-labelledby="req-h">
                <h2 id="req-h" className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">Student requests</h2>
                <ul className="divide-y divide-slate-800">
                  {REQUEST_BUTTONS.map(([kind, icon, label]) => (
                    <li key={kind} className="flex justify-between py-1.5 text-sm"><span>{icon} {label}</span><b className="text-lg">{requests[kind] || 0}</b></li>
                  ))}
                </ul>
              </section>
            </>
          ) : (
            <>
              <section className="p-4 rounded-xl bg-slate-900 border border-slate-800" aria-labelledby="tell-h">
                <h2 id="tell-h" className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">Tell your teacher</h2>
                <div className="grid grid-cols-2 gap-2">
                  {REQUEST_BUTTONS.map(([kind, icon, label]) => (
                    <Button key={kind} variant="secondary" size="sm" disabled={readOnly} onClick={() => request(kind, label)}><span aria-hidden="true">{icon}</span> {label}</Button>
                  ))}
                </div>
              </section>
              <SignInputPanel onSend={studentSend} onRequest={(k) => request(k, k.replace('_', ' '))} disabled={readOnly} />
            </>
          )}

          <section className="p-4 rounded-xl bg-slate-900 border border-slate-800" aria-labelledby="room-h">
            <h2 id="room-h" className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">In the room</h2>
            <ul className="flex flex-wrap gap-1.5">{presence.map((p) => <li key={p.id ?? p.name} className="text-xs px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700">{p.role === 'teacher' ? '🎓 ' : '🧑‍🎓 '}{p.name}</li>)}</ul>
          </section>
        </div>
      </div>

      <div role="status" aria-live="polite" className="text-xs text-emerald-300 min-h-[1.25rem]">{flash}</div>

      <Modal isOpen={confirmEnd} onClose={() => setConfirmEnd(false)} title="End this lecture?">
        <p className="text-sm text-slate-300 mb-4">Captions stop for everyone and the transcript is saved. This cannot be undone.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmEnd(false)}>Keep teaching</Button>
          <Button variant="danger" onClick={endLecture} loading={ending}>End lecture</Button>
        </div>
      </Modal>
    </div>
  );
}
