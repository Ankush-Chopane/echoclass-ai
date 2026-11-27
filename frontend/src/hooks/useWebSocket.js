import { useReducer, useEffect, useRef, useCallback, useState } from 'react';
import { api, wsBaseUrl } from '../services/api.js';

/**
 * Live classroom socket.
 *  - authenticates with a single-use ticket (the JWT never appears in the URL)
 *  - reconnects with exponential back-off, re-sending finals that were not acknowledged (the server de-duplicates by `cid`)
 *  - all server state lives in one reducer so React renders from a single source of truth
 */
const initial = { captions: [], interim: null, presence: [], flags: {}, requests: {}, studentAlerts: [], notifications: [], session: null, teacherVideo: { active: false, speaker: null, frame: null }, teacherAudioActive: false, teacherAudioOwned: false, teacherAudioError: null, audioListening: false, audioListeners: [], iceServers: [], studentVideos: {} };

export function reducer(state, a) {
  switch (a.type) {
    case 'reset': return initial;
    case 'init': {
      const sv = {};
      for (const item of a.studentVideos || []) {
        if (item?.userId != null) sv[item.userId] = { userId: item.userId, name: item.name, active: Boolean(item.active), frame: null };
      }
      return {
        ...state,
        captions: a.captions || [],
        flags: a.flags || {},
        requests: a.requests || {},
        session: a.session || null,
        teacherVideo: a.video ? { active: Boolean(a.video.active), speaker: a.video.speaker || null, frame: null } : { active: false, speaker: null, frame: null },
        teacherAudioActive: Boolean(a.teacherAudioActive),
        teacherAudioOwned: Boolean(a.teacherAudioOwned),
        teacherAudioError: null,
        audioListening: Boolean(a.audioListening),
        audioListeners: a.audioListeners || [],
        iceServers: Array.isArray(a.iceServers) ? a.iceServers : [],
        studentVideos: sv,
        interim: null
      };
    }
    case 'caption': {
      const c = a.caption;
      if (state.captions.some((x) => x.id === c.id)) return state;                                   // duplicate delivery after a reconnect
      const studentAlert = c.source === 'sign' || c.source === 'student'
        ? { id: `caption-${c.id}`, kind: 'caption', speaker: c.speaker, source: c.source, text: c.text }
        : null;
      const receivedAt = Date.now();
      const notification = studentAlert ? { ...studentAlert, receivedAt, read: false } : null;
      return {
        ...state,
        captions: [...state.captions, c],
        studentAlerts: studentAlert ? [...state.studentAlerts, { ...studentAlert, expiresAt: receivedAt + 30_000 }] : state.studentAlerts,
        notifications: notification ? [...state.notifications, notification].slice(-100) : state.notifications,
        interim: state.interim?.speaker === c.speaker ? null : state.interim
      };
    }
    case 'interim': return { ...state, interim: a.text ? { speaker: a.speaker, text: a.text } : null };
    case 'presence': return { ...state, presence: a.users || [] };
    case 'flag': return { ...state, flags: { ...state.flags, [a.captionId]: { ...(state.flags[a.captionId] || {}), [a.kind]: a.count } } };
    case 'request': {
      const receivedAt = Date.now();
      const notification = a.alert ? { ...a.alert, receivedAt, read: false } : null;
      return {
        ...state,
        requests: a.counts || state.requests,
        studentAlerts: notification ? [...state.studentAlerts, { ...notification, expiresAt: receivedAt + 30_000 }] : state.studentAlerts,
        notifications: notification ? [...state.notifications, notification].slice(-100) : state.notifications
      };
    }
    case 'dismiss_student_alert': return { ...state, studentAlerts: state.studentAlerts.filter((item) => item.id !== a.id) };
    case 'clear_student_alerts': return { ...state, studentAlerts: [] };
    case 'mark_notifications_read': {
      if (state.notifications.every((item) => item.read)) return state;
      return { ...state, notifications: state.notifications.map((item) => ({ ...item, read: true })) };
    }
    case 'clear_notifications': return { ...state, notifications: [] };
    case 'video_state': return { ...state, teacherVideo: { active: Boolean(a.active), speaker: a.speaker || null, frame: a.active ? state.teacherVideo.frame : null } };
    case 'video_frame': return { ...state, teacherVideo: { active: true, speaker: a.speaker || state.teacherVideo.speaker, frame: a.data } };
    case 'student_video_state': {
      const prev = state.studentVideos[a.userId];
      return { ...state, studentVideos: { ...state.studentVideos, [a.userId]: { userId: a.userId, name: a.name || prev?.name || 'Student', active: Boolean(a.active), frame: a.active ? (prev?.frame || null) : null } } };
    }
    case 'student_video_frame': {
      const prev = state.studentVideos[a.userId];
      return { ...state, studentVideos: { ...state.studentVideos, [a.userId]: { userId: a.userId, name: a.name || prev?.name || 'Student', active: true, frame: a.data } } };
    }
    case 'teacher_audio_state': return {
      ...state,
      teacherAudioActive: Boolean(a.active),
      teacherAudioOwned: Boolean(a.owned),
      teacherAudioError: a.error || null
    };
    case 'clear_teacher_audio_error': return { ...state, teacherAudioError: null };
    case 'audio_listen_state': return { ...state, audioListening: Boolean(a.active), teacherAudioActive: Boolean(a.teacherAudioActive) };
    case 'audio_listeners': return { ...state, audioListeners: a.listeners || [] };
    default: return state;
  }
}

const newCid = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;   // matches the server's /^[\w-]{6,64}$/

export function useWebSocket(sessionId) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [status, setStatus] = useState('connecting');       // connecting | connected | reconnecting | ended | failed
  const [notice, setNotice] = useState(null);                // last server error code, e.g. rate_limited or bad_caption
  const [failure, setFailure] = useState('');
  const wsRef = useRef(null);
  const outbox = useRef(new Map());                          // cid -> payload awaiting an ack
  const audioSignalHandlers = useRef(new Set());

  useEffect(() => {
    if (!sessionId) return undefined;
    let stopped = false, attempt = 0, retryTimer = null, pingTimer = null, ended = false;
    dispatch({ type: 'reset' });

    const flushOutbox = (ws) => outbox.current.forEach((payload) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(payload)));
    const fatal = (msg) => { stopped = true; setFailure(msg); setStatus('failed'); };

    async function open() {
      if (stopped) return;
      setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
      let ticket;
      try { ticket = (await api.getWsTicket(sessionId)).ticket; }
      catch (e) {
        if (e.status === 410) { ended = true; setStatus('ended'); return; }
        if ([401, 403, 404].includes(e.status)) return fatal(e.message);
        return retry();
      }
      if (stopped) return;
      const ws = new WebSocket(`${wsBaseUrl()}/ws?ticket=${encodeURIComponent(ticket)}`);
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0; setStatus('connected'); setNotice(null);
        flushOutbox(ws);
        clearInterval(pingTimer);
        pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ type: 'ping' })), 25_000);
      };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        switch (m.type) {
          case 'init': dispatch({ type: 'init', captions: m.captions, flags: m.flags, requests: m.requests, session: m.session, video: m.video, teacherAudioActive: m.teacherAudioActive, teacherAudioOwned: m.teacherAudioOwned, audioListening: m.audioListening, audioListeners: m.audioListeners, iceServers: m.iceServers, studentVideos: m.studentVideos }); break;
          case 'caption': dispatch({ type: 'caption', caption: m.caption }); break;
          case 'interim': dispatch({ type: 'interim', speaker: m.speaker, text: m.text }); break;
          case 'presence': dispatch({ type: 'presence', users: m.users }); break;
          case 'flag': dispatch({ type: 'flag', captionId: m.captionId, kind: m.kind, count: m.count }); break;
          case 'request': dispatch({
            type: 'request',
            counts: m.counts,
            alert: {
              id: `request-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              kind: 'request',
              speaker: m.user || 'Student',
              request: m.kind
            }
          }); break;
          case 'video_state': dispatch({ type: 'video_state', active: m.active, speaker: m.speaker }); break;
          case 'video_frame': dispatch({ type: 'video_frame', speaker: m.speaker, data: m.data }); break;
          case 'student_video_state': dispatch({ type: 'student_video_state', userId: m.userId, name: m.name, active: m.active }); break;
          case 'student_video_frame': dispatch({ type: 'student_video_frame', userId: m.userId, name: m.name, data: m.data }); break;
          case 'teacher_audio_state': dispatch({ type: 'teacher_audio_state', active: m.active, owned: m.owned, error: m.error }); break;
          case 'audio_listen_state': dispatch({ type: 'audio_listen_state', active: m.active, teacherAudioActive: m.teacherAudioActive }); break;
          case 'audio_listeners': dispatch({ type: 'audio_listeners', listeners: m.listeners }); break;
          case 'audio_signal': audioSignalHandlers.current.forEach((handler) => handler(m)); break;
          case 'ack': if (m.cid) outbox.current.delete(m.cid); break;
          case 'error': setNotice(m.code); break;
          case 'ended': ended = true; setStatus('ended'); break;
          default: break;
        }
      };
      ws.onclose = (ev) => {
        clearInterval(pingTimer);
        if (stopped) return;
        if (ended || ev.code === 1000) { ended = true; setStatus('ended'); return; }
        if (ev.code === 4008) return fatal('This class was opened in another tab or device, so this one was disconnected.');
        if (ev.code === 1008) return fatal('The connection was closed by the server (too many invalid messages).');
        retry();
      };
      ws.onerror = () => { /* onclose follows and handles the retry */ };
    }
    function retry() {
      if (stopped) return;
      setStatus('reconnecting');
      const delay = Math.min(1000 * 2 ** attempt, 15_000) + Math.random() * 500;
      attempt += 1;
      retryTimer = setTimeout(open, delay);
    }
    open();

    return () => {
      stopped = true; clearTimeout(retryTimer); clearInterval(pingTimer);
      const ws = wsRef.current; wsRef.current = null;
      if (ws) { ws.onclose = null; ws.onmessage = null; try { ws.close(1000); } catch { /* already closed */ } }
      outbox.current.clear();
    };
  }, [sessionId]);

  const raw = useCallback((payload) => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }, []);

  /** Finals are queued (and re-sent after a reconnect) until acknowledged; interim lines are fire-and-forget. Returns false only when a final could not even be queued. */
  const sendCaption = useCallback(({ text, final = true, source }) => {
    const payload = { type: 'caption', text, final, source };
    if (!final) { raw(payload); return true; }
    if (outbox.current.size >= 50) return false;
    payload.cid = newCid();
    outbox.current.set(payload.cid, payload);
    raw(payload);
    return true;
  }, [raw]);

  const sendFlag = useCallback((captionId, kind = 'confusing') => raw({ type: 'flag', captionId, kind }), [raw]);
  const sendRequest = useCallback((kind) => raw({ type: 'request', kind }), [raw]);

  const dismissStudentAlert = useCallback((id) => dispatch({ type: 'dismiss_student_alert', id }), []);
  const clearStudentAlerts = useCallback(() => dispatch({ type: 'clear_student_alerts' }), []);
  const markNotificationsRead = useCallback(() => dispatch({ type: 'mark_notifications_read' }), []);
  const clearNotifications = useCallback(() => dispatch({ type: 'clear_notifications' }), []);
  const clearTeacherAudioError = useCallback(() => dispatch({ type: 'clear_teacher_audio_error' }), []);
  const subscribeAudioSignals = useCallback((handler) => {
    audioSignalHandlers.current.add(handler);
    return () => audioSignalHandlers.current.delete(handler);
  }, []);

  return { ...state, status, connected: status === 'connected', ended: status === 'ended', failure, notice, sendCaption, sendFlag, sendRequest, sendRaw: raw, dismissStudentAlert, clearStudentAlerts, markNotificationsRead, clearNotifications, clearTeacherAudioError, subscribeAudioSignals };
}
