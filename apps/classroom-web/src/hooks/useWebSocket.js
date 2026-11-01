import { useReducer, useEffect, useRef, useCallback, useState } from 'react';
import { api, wsBaseUrl } from '../services/api';

/**
 * Live classroom socket.
 *  - authenticates with a single-use ticket (the JWT never appears in the URL)
 *  - reconnects with exponential back-off, re-sending finals that were not acknowledged (the server de-duplicates by `cid`)
 *  - all server state lives in one reducer so React renders from a single source of truth
 */
const initial = { captions: [], interim: null, presence: [], flags: {}, requests: {}, session: null };

function reducer(state, a) {
  switch (a.type) {
    case 'init': return { ...state, captions: a.captions || [], flags: a.flags || {}, requests: a.requests || {}, session: a.session || null, interim: null };
    case 'caption': {
      const c = a.caption;
      if (state.captions.some((x) => x.id === c.id)) return state;                                   // duplicate delivery after a reconnect
      return { ...state, captions: [...state.captions, c], interim: state.interim?.speaker === c.speaker ? null : state.interim };
    }
    case 'interim': return { ...state, interim: a.text ? { speaker: a.speaker, text: a.text } : null };
    case 'presence': return { ...state, presence: a.users || [] };
    case 'flag': return { ...state, flags: { ...state.flags, [a.captionId]: { ...(state.flags[a.captionId] || {}), [a.kind]: a.count } } };
    case 'request': return { ...state, requests: a.counts || state.requests };
    default: return state;
  }
}

const newCid = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;   // matches the server's /^[\w-]{6,64}$/

export function useWebSocket(sessionId) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [status, setStatus] = useState('connecting');       // connecting | connected | reconnecting | ended | failed
  const [notice, setNotice] = useState(null);                // last server error code, e.g. rate_limited, offline_speech_unavailable
  const [failure, setFailure] = useState('');
  const wsRef = useRef(null);
  const outbox = useRef(new Map());                          // cid -> payload awaiting an ack

  useEffect(() => {
    if (!sessionId) return undefined;
    let stopped = false, attempt = 0, retryTimer = null, pingTimer = null, ended = false;
    dispatch({ type: 'init' });

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
          case 'init': dispatch({ type: 'init', captions: m.captions, flags: m.flags, requests: m.requests, session: m.session }); break;
          case 'caption': dispatch({ type: 'caption', caption: m.caption }); break;
          case 'interim': dispatch({ type: 'interim', speaker: m.speaker, text: m.text }); break;
          case 'presence': dispatch({ type: 'presence', users: m.users }); break;
          case 'flag': dispatch({ type: 'flag', captionId: m.captionId, kind: m.kind, count: m.count }); break;
          case 'request': dispatch({ type: 'request', counts: m.counts }); break;
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

  return { ...state, status, connected: status === 'connected', ended: status === 'ended', failure, notice, sendCaption, sendFlag, sendRequest, sendRaw: raw };
}
