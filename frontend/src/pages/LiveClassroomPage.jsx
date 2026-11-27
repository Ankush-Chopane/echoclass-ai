import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useAccessibility } from '../hooks/useAccessibility';
import { useWebSocket } from '../hooks/useWebSocket';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';
import { useTeacherVideo } from '../hooks/useTeacherVideo';
import { useClassAudio } from '../hooks/useClassAudio';
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
  bad_caption: 'That message was rejected by the server.',
  audio_already_listening: 'Live audio is already enabled on another device for your account.',
  audio_listener_unavailable: 'A student who opted in is no longer connected. Live audio will continue for the others.'
};
const ENGINE_STATE = { off: 'Microphone off', starting: 'Starting microphone…', listening: 'Listening', retrying: 'Reconnecting speech service…', blocked: 'Microphone blocked', error: 'Speech stopped' };

export function LiveClassroomPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isTeacher } = useAuth();
  const { captionSize } = useAccessibility();

  const [classroom, setClassroom] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [waitingLive, setWaitingLive] = useState(false);
  const [loadError, setLoadError] = useState('');

  const [language, setLanguage] = useState('en-IN');
  const [typed, setTyped] = useState('');
  const [localInterim, setLocalInterim] = useState('');
  const [flash, setFlash] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const cooldown = useRef({});
  const scroller = useRef(null);
  const stick = useRef(true);

  // 1) Find the live session of this classroom. If none is live yet, poll every 4s so students auto-join when the teacher starts.
  useEffect(() => {
    let cancelled = false;
    let timer = null;
    async function check() {
      try {
        const cls = await api.getClassroom(id);
        if (cancelled) return;
        setClassroom(cls); setLanguage(cls.language || 'en-IN');
        if (cls.live) { setWaitingLive(false); setSessionId(cls.live.id); }
        else {
          setWaitingLive(true);
          timer = setTimeout(check, 4000);
        }
      } catch (e) { if (!cancelled) setLoadError(e.message); }
    }
    check();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [id]);

  const ws = useWebSocket(sessionId);
  const { captions, interim, presence, flags, requests, studentAlerts, notifications, teacherVideo, studentVideos, teacherAudioActive, teacherAudioOwned, teacherAudioError, audioListening, audioListeners, iceServers, status, notice, failure, sendCaption, sendFlag, sendRequest, sendRaw, clearTeacherAudioError } = ws;

  useEffect(() => { setNotificationsOpen(false); }, [sessionId]);

  // When the lecture ends (teacher pressed End, or it ended elsewhere) everyone is taken to the saved transcript.
  useEffect(() => { if (status === 'ended' && sessionId) { const t = setTimeout(() => navigate(`/transcripts/${sessionId}`, { replace: true }), 1500); return () => clearTimeout(t); } return undefined; }, [status, sessionId, navigate]);

  // 2) Teacher speech captions use the browser's Web Speech API.
  const browserMic = useSpeechRecognition({
    lang: language,
    onInterim: (t) => { setLocalInterim(t); if (t) sendCaption({ text: t.slice(-500), final: false, source: 'speech' }); },
    onFinal: (t) => { setLocalInterim(''); if (!sendCaption({ text: t, final: true, source: 'speech' })) setFlash('Too many unsent captions; check your connection.'); }
  });
  const mic = browserMic;
  const micOn = browserMic.listening;
  const teacherCam = useTeacherVideo({ sendRaw });
  const classAudio = useClassAudio({
    isTeacher,
    connected: ws.connected,
    ended: ws.ended || status === 'failed',
    sendRaw,
    clearTeacherAudioError,
    subscribeAudioSignals: ws.subscribeAudioSignals,
    teacherAudioActive,
    teacherAudioOwned,
    teacherAudioError,
    audioListening,
    audioListeners,
    iceServers
  });
  const stopAll = useCallback(() => { browserMic.stop(); teacherCam.stop(); classAudio.stopTeacherAudio(); }, [browserMic, teacherCam, classAudio.stopTeacherAudio]);

  useEffect(() => {
    if (!isTeacher) return undefined;
    const warn = (e) => { if (micOn || teacherCam.active || classAudio.teacherStatus === 'on') { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [isTeacher, micOn, teacherCam.active, classAudio.teacherStatus]);
  useEffect(() => {
    if (!isTeacher || !studentAlerts.length) return undefined;
    const timers = studentAlerts.map((alert) => setTimeout(
      () => ws.dismissStudentAlert(alert.id),
      Math.max(0, alert.expiresAt - Date.now())
    ));
    return () => timers.forEach(clearTimeout);
  }, [isTeacher, studentAlerts, ws.dismissStudentAlert]);
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
  if (waitingLive) {
    return (
      <div className="max-w-xl mx-auto mt-10 p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center" role="status" aria-live="polite">
        <LoadingIndicator text="Waiting for your teacher to start the live lecture…" />
        <p className="text-xs text-slate-400 mt-3 mb-4">This page will open the live classroom automatically as soon as the lecture starts.</p>
        <Link to={`/classrooms/${id}`}><Button variant="secondary">← Back to classroom</Button></Link>
      </div>
    );
  }
  if (!classroom || !sessionId) return <LoadingIndicator text="Opening the live classroom…" />;

  const [badgeStatus, badgeLabel] = CONNECTION[status] || CONNECTION.connecting;
  const lectureTitle = ws.session?.title || classroom.live?.title || classroom.name;
  const readOnly = status === 'ended' || status === 'failed';
  const latestSpeechCaption = [...captions].reverse().find((c) => c.source === 'speech' || c.source === 'typed');
  const videoSubtitleText = localInterim || interim?.text || latestSpeechCaption?.text || '';
  const videoSubtitleIsInterim = Boolean(localInterim || interim?.text);
  const showVideoStage = isTeacher ? (teacherCam.status === 'starting' || teacherCam.active) : teacherVideo.active;
  const studentsInRoom = presence.filter((p) => p.role === 'student');
  const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
  const unreadNotifications = notifications.filter((item) => !item.read).length;

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <header className="p-3 sm:p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <StatusBadge status={badgeStatus} label={badgeLabel} />
          <div>
            <Link to={`/classrooms/${id}`} className="text-[11px] text-slate-400 hover:text-white">← {classroom.name}</Link>
            <h1 className="text-base font-bold text-white leading-tight">{lectureTitle}</h1>
            <p className="text-xs text-slate-400" aria-live="polite">{presence.length} {presence.length === 1 ? 'person' : 'people'} in the room</p>
          </div>
        </div>
        {isTeacher
          ? <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                aria-expanded={notificationsOpen}
                onClick={() => {
                  const opening = !notificationsOpen;
                  setNotificationsOpen(opening);
                  if (opening) ws.markNotificationsRead();
                }}
              >
                🔔 Notifications{unreadNotifications > 0 ? ` (${unreadNotifications})` : ''}
              </Button>
              <Button variant="danger" size="sm" onClick={() => setConfirmEnd(true)} disabled={readOnly}>■ End lecture and save transcript</Button>
            </div>
          : <Button variant="secondary" size="sm" onClick={() => navigate(`/classrooms/${id}`)}>Leave class</Button>}
      </header>

      <div className="sr-only" role="status" aria-live="polite">{`Connection: ${badgeLabel}`}</div>
      {isTeacher && notificationsOpen && (
        <section id="student-notifications" className="rounded-xl border border-slate-700 bg-slate-900 p-4" aria-label="Student notification history">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-bold text-white">Student notifications</h2>
            <div className="flex gap-2">
              {notifications.length > 0 && <Button size="sm" variant="secondary" onClick={ws.clearNotifications}>Clear history</Button>}
              <Button size="sm" variant="secondary" onClick={() => setNotificationsOpen(false)}>Close</Button>
            </div>
          </div>
          {notifications.length === 0
            ? <p className="text-sm text-slate-400">Student messages and requests will appear here.</p>
            : <ol className="max-h-80 space-y-2 overflow-y-auto" aria-live="polite">
                {[...notifications].reverse().map((notification) => {
                  const isRequest = notification.kind === 'request';
                  const requestLabel = REQUEST_BUTTONS.find(([kind]) => kind === notification.request)?.[2];
                  return (
                    <li key={notification.id} className={`rounded-lg border p-3 ${notification.read ? 'border-slate-700 bg-slate-950/60' : 'border-amber-500/70 bg-amber-950/20'}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-amber-200">
                          {isRequest ? `Student request · ${notification.speaker}` : `Student message · ${notification.speaker}`}
                          {!notification.read && <span className="ml-2 text-xs text-amber-300">New</span>}
                        </p>
                        <time className="text-xs text-slate-400" dateTime={new Date(notification.receivedAt).toISOString()}>
                          {new Date(notification.receivedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                        </time>
                      </div>
                      <p className="mt-1 break-words text-sm text-white">
                        {isRequest ? requestLabel || 'Needs your attention' : notification.text}
                        {!isRequest && notification.source === 'sign' && <span className="ml-1 text-xs text-purple-300">(hand gesture)</span>}
                      </p>
                      <Button size="sm" className="mt-2" onClick={() => mic.start()} disabled={readOnly}>🎙 Start microphone to reply</Button>
                    </li>
                  );
                })}
              </ol>}
        </section>
      )}
      {isTeacher && studentAlerts.length > 0 && (
        <aside className="fixed top-20 right-3 z-50 w-[calc(100vw-1.5rem)] sm:w-[min(26rem,calc(100vw-2rem))] max-h-[60vh] overflow-y-auto flex flex-col gap-2" aria-label="New student messages and requests">
          {[...studentAlerts].reverse().map((alert) => {
            const requestLabel = REQUEST_BUTTONS.find(([kind]) => kind === alert.request)?.[2];
            const isRequest = alert.kind === 'request';
            return (
              <section key={alert.id} role="alert" className="rounded-xl border-2 border-amber-400 bg-slate-950 shadow-2xl shadow-black/50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-amber-200">
                      {isRequest ? `Student request · ${alert.speaker}` : `Student message · ${alert.speaker}`}
                    </p>
                    <p className="mt-1 text-sm text-white break-words">
                      {isRequest ? requestLabel || 'Needs your attention' : alert.text}
                      {!isRequest && alert.source === 'sign' && <span className="ml-1 text-xs text-purple-300">(hand gesture)</span>}
                    </p>
                  </div>
                  <button type="button" onClick={() => ws.dismissStudentAlert(alert.id)} aria-label="Dismiss student alert" className="shrink-0 rounded px-2 py-1 text-slate-300 hover:bg-slate-800 hover:text-white">✕</button>
                </div>
                {micOn
                  ? <p role="status" className="mt-2 text-xs text-emerald-200">Microphone is on — speak your reply.</p>
                  : <Button size="sm" className="mt-2" onClick={() => mic.start()} disabled={readOnly}>🎙 Start microphone to reply</Button>}
              </section>
            );
          })}
          {studentAlerts.length > 1 && (
            <Button size="sm" variant="secondary" className="self-end" onClick={ws.clearStudentAlerts}>Dismiss all alerts</Button>
          )}
        </aside>
      )}
      {failure && <div role="alert" className="p-3 rounded-lg border border-rose-500/40 bg-rose-500/10 text-rose-300 text-sm">{failure}</div>}
      {status === 'ended' && <div role="status" className="p-3 rounded-lg border border-slate-700 bg-slate-900 text-sm">This lecture has ended. Opening the transcript…</div>}
      {status === 'reconnecting' && <div role="status" className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm">Connection lost. Reconnecting… {isTeacher ? 'Captions you speak meanwhile are kept and sent when the connection returns.' : ''}</div>}
      {notice && NOTICES[notice] && <div role="alert" className="p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-200 text-sm">{NOTICES[notice]}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* left column: optional teacher video + live captions */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {isTeacher && (
            <section className={`rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 ${showVideoStage ? '' : 'hidden'}`} aria-label="Teacher video preview">
              <div className="px-3 py-2 bg-slate-900/70 border-b border-slate-800 flex items-center justify-between text-xs text-slate-300">
                <span className="font-semibold flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-rose-500 animate-pulse" aria-hidden="true" />
                  Your live video (visible to students)
                </span>
                <Button variant="danger" size="sm" onClick={teacherCam.stop}>Turn off video</Button>
              </div>
              <div className="relative bg-black aspect-video max-h-[240px] sm:max-h-[340px] mx-auto flex items-center justify-center">
                <video ref={teacherCam.videoRef} playsInline muted className="w-full h-full object-contain -scale-x-100" aria-label="Teacher camera preview" />
              </div>
              <div className="px-4 py-2.5 bg-slate-900 border-t border-slate-800 min-h-[3rem] flex items-center" aria-live="polite">
                {videoSubtitleText ? (
                  <p style={{ fontSize: `${Math.max(15, Math.min(captionSize, 26))}px`, lineHeight: 1.35 }} className={videoSubtitleIsInterim ? 'italic text-emerald-300 font-medium' : 'text-white font-semibold'}>
                    {videoSubtitleText}
                  </p>
                ) : (
                  <p className="text-xs text-slate-400 italic">Start your microphone to show live speech subtitles below your video.</p>
                )}
              </div>
            </section>
          )}

          {!isTeacher && showVideoStage && (
            <section className="rounded-2xl overflow-hidden border border-slate-800 bg-slate-950" aria-label="Teacher live video">
              <div className="px-3 py-2 bg-slate-900/70 border-b border-slate-800 flex items-center justify-between text-xs text-slate-300">
                <span className="font-semibold flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-rose-500 animate-pulse" aria-hidden="true" />
                  {teacherVideo.speaker ? `${teacherVideo.speaker} (Teacher)` : 'Teacher live video'}
                </span>
                <span className="text-[11px] text-emerald-400 font-semibold">LIVE VIDEO</span>
              </div>
              <div className="relative bg-black aspect-video max-h-[240px] sm:max-h-[340px] mx-auto flex items-center justify-center">
                {teacherVideo.frame ? (
                  <img src={teacherVideo.frame} alt="Teacher live video" className="w-full h-full object-contain -scale-x-100" />
                ) : (
                  <p className="text-xs text-slate-400">Connecting to teacher video…</p>
                )}
              </div>
              <div className="px-4 py-2.5 bg-slate-900 border-t border-slate-800 min-h-[3rem] flex items-center" aria-live="polite">
                {videoSubtitleText ? (
                  <p style={{ fontSize: `${Math.max(15, Math.min(captionSize, 26))}px`, lineHeight: 1.35 }} className={videoSubtitleIsInterim ? 'italic text-emerald-300 font-medium' : 'text-white font-semibold'}>
                    {videoSubtitleText}
                  </p>
                ) : (
                  <p className="text-xs text-slate-400 italic">Waiting for teacher speech…</p>
                )}
              </div>
            </section>
          )}

          {isTeacher && (
            <section className="p-3 sm:p-4 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col gap-3" aria-labelledby="students-grid-h">
              <div className="flex items-center justify-between gap-2">
                <h2 id="students-grid-h" className="text-xs font-bold uppercase tracking-wider text-slate-300">
                  👥 Student cameras ({studentsInRoom.length} in class)
                </h2>
                <span className="text-[11px] text-slate-400">
                  {studentsInRoom.filter((s) => studentVideos[s.id]?.active).length} camera on
                </span>
              </div>
              {studentsInRoom.length === 0 ? (
                <p className="text-xs text-slate-400 italic py-3 text-center bg-slate-950/60 rounded-xl border border-slate-800/80">
                  Waiting for students to enter the live class…
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  {studentsInRoom.map((s) => {
                    const sv = studentVideos[s.id];
                    const camOn = Boolean(sv?.active && sv?.frame);
                    return (
                      <div key={s.id} className="relative aspect-video rounded-xl overflow-hidden bg-slate-950 border border-slate-800 flex items-center justify-center">
                        {camOn ? (
                          <img src={sv.frame} alt={`${s.name} camera`} className="w-full h-full object-cover -scale-x-100" />
                        ) : (
                          <div className="flex flex-col items-center gap-1 text-center px-2">
                            <span className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 text-emerald-300 font-bold text-xs flex items-center justify-center">
                              {initials(s.name)}
                            </span>
                            <span className="text-[10px] text-slate-400">{sv?.active ? 'Connecting…' : 'Camera off'}</span>
                          </div>
                        )}
                        <div className="absolute inset-x-0 bottom-0 px-2 py-1 bg-gradient-to-t from-black/85 via-black/50 to-transparent flex items-center justify-between gap-1 text-[11px]">
                          <span className="text-white font-medium truncate">{s.name}</span>
                          <span className={`shrink-0 w-2 h-2 rounded-full ${camOn ? 'bg-emerald-400' : 'bg-slate-500'}`} aria-hidden="true" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          <section className={`flex flex-col bg-slate-950 border border-slate-800 rounded-2xl overflow-hidden ${showVideoStage ? 'h-[40vh] sm:h-[45vh] min-h-[240px]' : 'h-[52vh] lg:h-[calc(100vh-14rem)] min-h-[280px]'}`} aria-label="Live captions">
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
        </div>

        {/* side panel */}
        <div className="flex flex-col gap-4">
          {isTeacher ? (
            <>
              <section className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col gap-3" aria-labelledby="mic-h">
                <h2 id="mic-h" className="text-xs font-bold uppercase tracking-wider text-slate-300">Teacher camera &amp; microphone</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant={micOn ? 'danger' : 'primary'} onClick={micOn ? mic.stop : mic.start} aria-pressed={micOn} disabled={readOnly || !browserMic.supported}>
                    {micOn ? '■ Stop microphone' : '🎙 Start microphone'}
                  </Button>
                  <Button variant={teacherCam.active ? 'danger' : 'secondary'} onClick={teacherCam.active ? teacherCam.stop : teacherCam.start} aria-pressed={teacherCam.active} disabled={readOnly || teacherCam.status === 'starting'}>
                    {teacherCam.active ? '📹 Turn off video' : teacherCam.status === 'starting' ? 'Starting camera…' : '📹 Turn on video'}
                  </Button>
                </div>
                <span className="text-xs text-slate-300" role="status" aria-live="polite">{ENGINE_STATE[browserMic.state]}{teacherCam.active ? ' · Video on' : ''}</span>
                {teacherCam.error && <p role="alert" className="text-xs text-rose-300">{teacherCam.error}</p>}
                {mic.message && <p role="alert" className="text-xs text-amber-300">{mic.message}</p>}
                {!browserMic.supported && <p className="text-xs text-amber-300">This browser does not support speech recognition. Use Chrome, Edge or Safari, or type captions below.</p>}

                {browserMic.supported && (
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

              <section className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col gap-3" aria-labelledby="audio-h">
                <h2 id="audio-h" className="text-xs font-bold uppercase tracking-wider text-slate-300">Optional live teacher audio</h2>
                <p className="text-xs text-slate-400">Students must choose to listen. Audio is streamed live and is not recorded.</p>
                <Button
                  variant={classAudio.teacherStatus === 'on' ? 'danger' : 'secondary'}
                  onClick={classAudio.teacherStatus === 'on' ? classAudio.stopTeacherAudio : classAudio.startTeacherAudio}
                  aria-pressed={teacherAudioActive && teacherAudioOwned}
                  disabled={readOnly || !ws.connected || classAudio.teacherStatus === 'starting'}
                >
                  {classAudio.teacherStatus === 'on' ? '■ Stop sharing live audio' : classAudio.teacherStatus === 'starting' ? 'Starting live audio…' : 'Enable live audio for students'}
                </Button>
                <p className="text-xs text-slate-300" role="status" aria-live="polite">
                  {classAudio.teacherStatus === 'on' && teacherAudioOwned ? `Sharing · ${classAudio.teacherListeningCount} ${classAudio.teacherListeningCount === 1 ? 'student' : 'students'} opted in` : teacherAudioActive ? 'Another teacher device is sharing live audio.' : 'Live audio is off.'}
                </p>
                {classAudio.teacherError && <p role="alert" className="text-xs text-rose-300">{classAudio.teacherError}</p>}
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
              <section className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col gap-3" aria-labelledby="listen-h">
                <h2 id="listen-h" className="text-xs font-bold uppercase tracking-wider text-slate-300">Listen to your teacher</h2>
                <p className="text-xs text-slate-400">This is optional and separate from captions. Live audio is not recorded.</p>
                <Button
                  variant={audioListening ? 'primary' : 'secondary'}
                  onClick={() => classAudio.listen(!audioListening)}
                  aria-pressed={audioListening}
                  disabled={readOnly || !ws.connected || (!audioListening && !teacherAudioActive)}
                >
                  {audioListening ? 'Turn off listening' : teacherAudioActive ? 'Listen to teacher' : 'Teacher audio is off'}
                </Button>
                <audio ref={classAudio.audioRef} autoPlay controls onPlay={classAudio.playbackStarted} className={audioListening && teacherAudioActive ? 'w-full' : 'hidden'} aria-label="Teacher live audio" />
                {classAudio.playbackBlocked && <p role="status" className="text-xs text-amber-200">Playback was blocked. Press play in the audio controls to listen.</p>}
                {classAudio.studentError && <p role="alert" className="text-xs text-rose-300">{classAudio.studentError}</p>}
              </section>
              <section className="p-4 rounded-xl bg-slate-900 border border-slate-800" aria-labelledby="tell-h">
                <h2 id="tell-h" className="text-xs font-bold uppercase tracking-wider text-slate-300 mb-2">Tell your teacher</h2>
                <div className="grid grid-cols-2 gap-2">
                  {REQUEST_BUTTONS.map(([kind, icon, label]) => (
                    <Button key={kind} variant="secondary" size="sm" disabled={readOnly} onClick={() => request(kind, label)}><span aria-hidden="true">{icon}</span> {label}</Button>
                  ))}
                </div>
              </section>
              <SignInputPanel onSend={studentSend} onRequest={(k) => request(k, k.replace('_', ' '))} sendRaw={sendRaw} disabled={readOnly} />
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
