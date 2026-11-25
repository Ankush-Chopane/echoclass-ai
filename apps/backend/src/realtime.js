// WebSocket hub: authenticated by single-use, short-lived tickets (never a long-lived token in the URL),
// membership-checked on connect, schema-validated per message, rate-limited and de-duplicated.
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const T = require('./text');
const log = require('./log');
const { cleanText } = require('./security');

const REQUEST_KINDS = new Set(['raise_hand', 'slow_down', 'repeat', 'louder', 'understood']);
const FLAG_KINDS = new Set(['confusing', 'important']);
const SOURCES = { teacher: new Set(['speech', 'typed']), student: new Set(['sign', 'student']) };
const CID = /^[\w-]{6,64}$/;
const TICKET_TTL_MS = 30_000, MAX_PER_SESSION = 400, MAX_PER_USER = 4;

function createHub({ db, loadUser, access, server, allowedOrigins = [], speechEngine }) {
  const rooms = new Map();       // sessionId -> Set<ws>
  const tickets = new Map();     // ticket -> { userId, sessionId, exp }
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  let activeStreamingWs = null;

  if (speechEngine) {
    speechEngine.on('interim', (text) => {
      if (activeStreamingWs && activeStreamingWs.readyState === 1) {
        const textClean = cleanText(text, 600);
        if (textClean) {
          const fixed = T.applyVocab(textClean, q.vocab.all(activeStreamingWs.classroomId));
          broadcast(activeStreamingWs.sid, { type: 'interim', speaker: activeStreamingWs.user.name, source: 'speech', text: fixed });   // the teacher is in the room, so this reaches them too
        }
      }
    });

    speechEngine.on('final', (text) => {
      if (activeStreamingWs && activeStreamingWs.readyState === 1) {
        const textClean = cleanText(text, 600);
        if (textClean) {
          const s = q.session.get(activeStreamingWs.sid);
          if (s && !s.ended_at) {
            publishCaption(s, activeStreamingWs.classroomId, {
              source: 'speech',
              speaker: activeStreamingWs.user.name,
              text: textClean,
              userId: activeStreamingWs.user.id
            });
          }
        }
      }
    });
  }
  const q = {
    session: db.prepare('SELECT * FROM sessions WHERE id = ?'),
    vocab: db.prepare('SELECT heard, replacement FROM vocab WHERE classroom_id=?'),
    insCaption: db.prepare('INSERT OR IGNORE INTO captions(session_id,source,speaker,text,t_ms,created_at,client_id,user_id) VALUES(?,?,?,?,?,?,?,?)'),
    byClient: db.prepare('SELECT id FROM captions WHERE session_id=? AND client_id=?'),
    captions: db.prepare('SELECT id, source, speaker, text, t_ms FROM (SELECT * FROM captions WHERE session_id=? ORDER BY id DESC LIMIT 200) ORDER BY id'),
    flagCounts: db.prepare('SELECT caption_id, kind, COUNT(*) AS n FROM flags WHERE session_id=? GROUP BY caption_id, kind'),
    reqCounts: db.prepare('SELECT kind, COUNT(*) AS n FROM requests WHERE session_id=? GROUP BY kind'),
    capOk: db.prepare('SELECT id FROM captions WHERE id=? AND session_id=?'),
    insFlag: db.prepare('INSERT OR IGNORE INTO flags(session_id,caption_id,user_id,kind,created_at) VALUES(?,?,?,?,?)'),
    flagN: db.prepare('SELECT COUNT(*) n FROM flags WHERE caption_id=? AND kind=?'),
    insReq: db.prepare('INSERT INTO requests(session_id,user_id,kind,created_at) VALUES(?,?,?,?)'),
  };
  const reqCounts = (sid) => Object.fromEntries(q.reqCounts.all(sid).map(r => [r.kind, r.n]));

  function issueTicket(user, sessionId) {
    const now = Date.now();
    for (const [k, v] of tickets) if (v.exp < now) tickets.delete(k);
    if (tickets.size > 5000) throw Object.assign(new Error('busy'), { status: 503 });
    const t = crypto.randomBytes(24).toString('base64url');
    tickets.set(t, { userId: user.id, sessionId, exp: now + TICKET_TTL_MS });
    return t;
  }

  function broadcast(sid, msg, except) {
    const data = JSON.stringify(msg);
    for (const w of rooms.get(sid) || []) if (w !== except && w.readyState === 1) w.send(data);
  }
  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };
  const presenceTimers = new Map();
  function presence(sid) {
    if (presenceTimers.has(sid)) return;
    presenceTimers.set(sid, setTimeout(() => {
      presenceTimers.delete(sid);
      const seen = new Map();
      for (const w of rooms.get(sid) || []) seen.set(w.user.id, { id: w.user.id, name: w.user.name, role: w.user.role });
      broadcast(sid, { type: 'presence', users: [...seen.values()] });
    }, 80));
    presenceTimers.get(sid).unref?.();
  }

  /** Persist + broadcast a finalized caption. Shared by sockets and the optional server-side transcription route. */
  function publishCaption(session, classroomId, { source, speaker, text, userId, cid = null }) {
    const vocab = q.vocab.all(classroomId);
    const fixed = T.applyVocab(text, vocab);
    const t = Date.now();
    const r = q.insCaption.run(session.id, source, speaker, fixed, t - session.started_at, t, cid, userId);
    if (r.changes === 0) return { id: q.byClient.get(session.id, cid)?.id, duplicate: true };
    const caption = { id: Number(r.lastInsertRowid), source, speaker, text: fixed, t_ms: t - session.started_at };
    broadcast(session.id, { type: 'caption', caption });
    return { id: caption.id, caption, duplicate: false };
  }

  server.on('upgrade', (req, socket, head) => {
    const reject = (code, msg) => { try { socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { /* ignore */ } socket.destroy(); };
    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname !== '/ws') return reject(404, 'Not Found');
      if (url.searchParams.has('token')) return reject(400, 'Bad Request');           // long-lived tokens are never accepted in URLs
      const origin = req.headers.origin;
      if (origin) {
        let host = ''; try { host = new URL(origin).host; } catch { /* invalid */ }
        if (host !== req.headers.host && !allowedOrigins.includes(origin.replace(/\/+$/, ''))) return reject(403, 'Forbidden');
      }
      const ticket = url.searchParams.get('ticket') || '';
      const t = tickets.get(ticket); tickets.delete(ticket);                           // single use
      if (!t || t.exp < Date.now()) return reject(401, 'Unauthorized');
      const user = loadUser(t.userId); const s = q.session.get(t.sessionId);
      if (!user || !s) return reject(401, 'Unauthorized');
      const c = access(user, s.classroom_id); if (!c) return reject(403, 'Forbidden');
      if (s.ended_at) return reject(410, 'Gone');
      const room = rooms.get(s.id) || new Set();
      if (room.size >= MAX_PER_SESSION) return reject(503, 'Service Unavailable');
      const mine = [...room].filter(w => w.user.id === user.id);
      if (mine.length >= MAX_PER_USER) mine[0].close(4008, 'Replaced by a newer connection');
      wss.handleUpgrade(req, socket, head, (ws) => { ws.user = { id: user.id, name: user.name, role: user.role }; ws.sid = s.id; ws.classroomId = c.id; wss.emit('connection', ws); });
    } catch { reject(400, 'Bad Request'); }
  });

  wss.on('connection', (ws) => {
    const sid = ws.sid, user = ws.user, teacher = user.role === 'teacher';
    if (!rooms.has(sid)) rooms.set(sid, new Set());
    rooms.get(sid).add(ws);
    ws.isAlive = true; ws.on('pong', () => (ws.isAlive = true));
    ws.on('error', () => {});
    ws.rate = []; ws.bad = 0; ws.lastInterim = 0; ws.lastFinal = { text: '', at: 0, id: null }; ws.cool = {};
    const flags = {}; for (const f of q.flagCounts.all(sid)) (flags[f.caption_id] ||= {})[f.kind] = f.n;
    send(ws, { type: 'init', session: q.session.get(sid), captions: q.captions.all(sid), flags, requests: reqCounts(sid), you: { id: user.id, role: user.role } });
    presence(sid);

    const violation = (code) => { send(ws, { type: 'error', code }); if (++ws.bad > 20) ws.close(1008, 'Too many invalid messages'); };

    ws.on('message', (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return violation('bad_json'); }
      if (!m || typeof m !== 'object' || typeof m.type !== 'string') return violation('bad_message');
      const now = Date.now();
      if (m.type !== 'speech_chunk') {
        while (ws.rate.length && now - ws.rate[0] > 5000) ws.rate.shift();
        if (ws.rate.length >= (teacher ? 120 : 30)) { if (!ws.warned || now - ws.warned > 3000) { ws.warned = now; send(ws, { type: 'error', code: 'rate_limited' }); } return; }
        ws.rate.push(now);
      }
      const s = q.session.get(sid);
      if (!s || s.ended_at) { send(ws, { type: 'ended' }); return ws.close(1000, 'Session ended'); }

      if (m.type === 'ping') return send(ws, { type: 'pong' });

      if (teacher && m.type === 'speech_chunk') {
        if (typeof m.data !== 'string' || m.data.length > 65536 || !/^[A-Za-z0-9+/]+={0,2}$/.test(m.data)) return violation('bad_audio');
        if (!speechEngine?.isModelInstalled?.()) { if (!ws.warnedSpeech) { ws.warnedSpeech = true; send(ws, { type: 'error', code: 'offline_speech_unavailable' }); } return; }
        // One recogniser process serves one class at a time: refuse instead of mixing two teachers' audio.
        if (activeStreamingWs && activeStreamingWs !== ws && activeStreamingWs.readyState === 1 && activeStreamingWs.sid !== sid) {
          if (!ws.warnedBusy) { ws.warnedBusy = true; send(ws, { type: 'error', code: 'offline_speech_busy' }); } return;
        }
        if (activeStreamingWs !== ws) { activeStreamingWs = ws; speechEngine.reset(); }
        speechEngine.feedAudio(m.data);
        return;
      }

      if (teacher && m.type === 'speech_stop') {
        speechEngine?.flush();
        return;
      }

      if (m.type === 'caption') {
        const text = cleanText(m.text, 600), source = m.source;
        if (!text || typeof m.text !== 'string' || !SOURCES[user.role].has(source)) return violation('bad_caption');
        if (m.cid != null && (typeof m.cid !== 'string' || !CID.test(m.cid))) return violation('bad_cid');
        const speaker = user.name;
        if (m.final !== true) {
          if (now - ws.lastInterim < 100) return;           // coalesce interim bursts
          ws.lastInterim = now;
          return broadcast(sid, { type: 'interim', speaker, source, text: T.applyVocab(text, q.vocab.all(ws.classroomId)) }, ws);
        }
        // identical text from the same person within 1.5 s = recogniser repeating itself (seen on Android Chrome)
        if (ws.lastFinal.text === text && now - ws.lastFinal.at < 1500) { return send(ws, { type: 'ack', cid: m.cid ?? null, id: ws.lastFinal.id, duplicate: true }); }
        const r = publishCaption(s, ws.classroomId, { source, speaker, text, userId: user.id, cid: m.cid ?? null });
        ws.lastFinal = { text, at: now, id: r.id };
        return send(ws, { type: 'ack', cid: m.cid ?? null, id: r.id, duplicate: r.duplicate });
      }

      if (!teacher && m.type === 'request') {
        if (!REQUEST_KINDS.has(m.kind)) return violation('bad_request');
        if (ws.cool[m.kind] && now - ws.cool[m.kind] < 3000) return;
        ws.cool[m.kind] = now;
        q.insReq.run(sid, user.id, m.kind, now);
        return broadcast(sid, { type: 'request', kind: m.kind, user: user.name, counts: reqCounts(sid) });
      }

      if (!teacher && m.type === 'flag') {
        if (!FLAG_KINDS.has(m.kind) || !Number.isInteger(m.captionId)) return violation('bad_flag');
        const cap = q.capOk.get(m.captionId, sid); if (!cap) return violation('bad_flag');
        if (q.insFlag.run(sid, cap.id, user.id, m.kind, now).changes === 0) return;   // already flagged by this user
        return broadcast(sid, { type: 'flag', captionId: cap.id, kind: m.kind, count: q.flagN.get(cap.id, m.kind).n });
      }
      violation('not_allowed');
    });

    ws.on('close', () => {
      if (activeStreamingWs === ws) {
        activeStreamingWs = null;
        speechEngine?.reset();
      }
      const room = rooms.get(sid); room?.delete(ws);
      if (room && !room.size) rooms.delete(sid); else presence(sid);
    });
    ws.on('error', () => {});
  });

  const beat = setInterval(() => wss.clients.forEach(w => { if (!w.isAlive) return w.terminate(); w.isAlive = false; try { w.ping(); } catch { /* closing */ } }), 30000);
  beat.unref();

  return {
    issueTicket, publishCaption, broadcast,
    endSession(sid) { broadcast(sid, { type: 'ended' }); setTimeout(() => (rooms.get(sid) || []).forEach(w => w.close(1000, 'Session ended')), 400).unref(); },
    disconnectUser(userId) { for (const room of rooms.values()) for (const w of room) if (w.user.id === userId) w.close(4001, 'Signed out'); },
    stats: () => ({ rooms: rooms.size, sockets: wss.clients.size }),
    close() { clearInterval(beat); for (const t of presenceTimers.values()) clearTimeout(t); wss.clients.forEach(w => w.close(1001, 'Server restarting')); setTimeout(() => wss.clients.forEach(w => w.terminate()), 1500).unref(); },
  };
}
module.exports = { createHub };