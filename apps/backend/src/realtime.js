// WebSocket hub: authenticated by single-use, short-lived tickets (never a long-lived token in the URL),
// membership-checked on connect, schema-validated per message, rate-limited and de-duplicated.
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { nextId } = require('./db');
const T = require('./text');
const log = require('./log');
const { cleanText } = require('./security');

const REQUEST_KINDS = new Set(['raise_hand', 'slow_down', 'repeat', 'louder', 'understood']);
const FLAG_KINDS = new Set(['confusing', 'important']);
const SOURCES = { teacher: new Set(['speech', 'typed']), student: new Set(['sign', 'student']) };
const CID = /^[\w-]{6,64}$/;
const TICKET_TTL_MS = 30_000, MAX_PER_SESSION = 400, MAX_PER_USER = 4;

function doc(d) {
  if (!d) return null;
  const { _id, ...rest } = d;
  return { id: _id, ...rest };
}

async function createHub({ db, loadUser, access, server, allowedOrigins = [], speechEngine }) {
  const rooms = new Map();       // sessionId -> Set<ws>
  const tickets = new Map();     // ticket -> { userId, sessionId, exp }
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  let activeStreamingWs = null;

  async function getReqCounts(sid) {
    const rows = await db.collection('requests').aggregate([
      { $match: { session_id: sid } },
      { $group: { _id: '$kind', n: { $sum: 1 } } }
    ]).toArray();
    return Object.fromEntries(rows.map(r => [r._id, r.n]));
  }

  async function getFlagCounts(sid) {
    const rows = await db.collection('flags').aggregate([
      { $match: { session_id: sid } },
      { $group: { _id: { caption_id: '$caption_id', kind: '$kind' }, n: { $sum: 1 } } }
    ]).toArray();
    const flags = {};
    for (const r of rows) {
      (flags[r._id.caption_id] ||= {})[r._id.kind] = r.n;
    }
    return flags;
  }

  function broadcast(sid, msg, except) {
    const data = JSON.stringify(msg);
    for (const w of rooms.get(sid) || []) if (w !== except && w.readyState === 1) w.send(data);
  }
  const send = (ws, msg) => { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); };

  /** Persist + broadcast a finalized caption. Shared by sockets and the optional server-side transcription route. */
  async function publishCaption(session, classroomId, { source, speaker, text, userId, cid = null }) {
    const sessionId = session._id ?? session.id;
    const vocab = await db.collection('vocab').find({ classroom_id: classroomId }).toArray();
    const fixed = T.applyVocab(text, vocab);
    const t = Date.now();
    const startedAt = session.started_at || t;
    const t_ms = t - startedAt;

    if (cid) {
      const existing = await db.collection('captions').findOne({ session_id: sessionId, client_id: cid });
      if (existing) {
        return { id: existing._id, caption: doc(existing), duplicate: true };
      }
    }

    const id = await nextId('captions', db);
    const captionDoc = {
      _id: id,
      session_id: sessionId,
      source,
      speaker,
      text: fixed,
      t_ms,
      created_at: t,
      client_id: cid || null,
      user_id: userId ?? null
    };

    try {
      await db.collection('captions').insertOne(captionDoc);
    } catch (err) {
      if (err.code === 11000 && cid) {
        const existing = await db.collection('captions').findOne({ session_id: sessionId, client_id: cid });
        return { id: existing ? existing._id : id, caption: existing ? doc(existing) : null, duplicate: true };
      }
      throw err;
    }

    const caption = { id, source, speaker, text: fixed, t_ms };
    broadcast(sessionId, { type: 'caption', caption });
    return { id, caption, duplicate: false };
  }

  if (speechEngine) {
    speechEngine.on('interim', async (text) => {
      try {
        if (activeStreamingWs && activeStreamingWs.readyState === 1) {
          const textClean = cleanText(text, 600);
          if (textClean) {
            const vocab = await db.collection('vocab').find({ classroom_id: activeStreamingWs.classroomId }).toArray();
            const fixed = T.applyVocab(textClean, vocab);
            broadcast(activeStreamingWs.sid, { type: 'interim', speaker: activeStreamingWs.user.name, source: 'speech', text: fixed });
          }
        }
      } catch (e) {
        log.error('speechEngine interim error', { err: e.message });
      }
    });

    speechEngine.on('final', async (text) => {
      try {
        if (activeStreamingWs && activeStreamingWs.readyState === 1) {
          const textClean = cleanText(text, 600);
          if (textClean) {
            const s = await db.collection('sessions').findOne({ _id: activeStreamingWs.sid });
            if (s && !s.ended_at) {
              await publishCaption(s, activeStreamingWs.classroomId, {
                source: 'speech',
                speaker: activeStreamingWs.user.name,
                text: textClean,
                userId: activeStreamingWs.user.id
              });
            }
          }
        }
      } catch (e) {
        log.error('speechEngine final error', { err: e.message });
      }
    });
  }

  function issueTicket(user, sessionId) {
    const now = Date.now();
    for (const [k, v] of tickets) if (v.exp < now) tickets.delete(k);
    if (tickets.size > 5000) throw Object.assign(new Error('busy'), { status: 503 });
    const t = crypto.randomBytes(24).toString('base64url');
    tickets.set(t, { userId: user.id ?? user._id, sessionId, exp: now + TICKET_TTL_MS });
    return t;
  }

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

  server.on('upgrade', async (req, socket, head) => {
    const reject = (code, msg) => {
      try { socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { /* ignore */ }
      socket.destroy();
    };

    try {
      const url = new URL(req.url, 'http://x');
      if (url.pathname !== '/ws') return reject(404, 'Not Found');
      if (url.searchParams.has('token')) return reject(400, 'Bad Request');
      const origin = req.headers.origin;
      if (origin) {
        let host = ''; try { host = new URL(origin).host; } catch { /* invalid */ }
        if (host !== req.headers.host && !allowedOrigins.includes(origin.replace(/\/+$/, ''))) return reject(403, 'Forbidden');
      }
      const ticket = url.searchParams.get('ticket') || '';
      const t = tickets.get(ticket); tickets.delete(ticket);
      if (!t || t.exp < Date.now()) return reject(401, 'Unauthorized');
      const user = await loadUser(t.userId);
      const s = await db.collection('sessions').findOne({ _id: t.sessionId });
      if (!user || !s) return reject(401, 'Unauthorized');
      const c = await access(doc(user), s.classroom_id);
      if (!c) return reject(403, 'Forbidden');
      if (s.ended_at) return reject(410, 'Gone');
      const room = rooms.get(s._id) || new Set();
      if (room.size >= MAX_PER_SESSION) return reject(503, 'Service Unavailable');
      const userId = user._id ?? user.id;
      const mine = [...room].filter(w => w.user.id === userId);
      if (mine.length >= MAX_PER_USER) mine[0].close(4008, 'Replaced by a newer connection');
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.user = { id: userId, name: user.name, role: user.role };
        ws.sid = s._id;
        ws.classroomId = c._id ?? c.id;
        wss.emit('connection', ws);
      });
    } catch {
      reject(400, 'Bad Request');
    }
  });

  wss.on('connection', (ws) => {
    const sid = ws.sid, user = ws.user, teacher = user.role === 'teacher';
    if (!rooms.has(sid)) rooms.set(sid, new Set());
    rooms.get(sid).add(ws);
    ws.isAlive = true; ws.on('pong', () => (ws.isAlive = true));
    ws.on('error', () => {});
    ws.rate = []; ws.bad = 0; ws.lastInterim = 0; ws.lastFinal = { text: '', at: 0, id: null }; ws.cool = {};

    (async () => {
      const session = await db.collection('sessions').findOne({ _id: sid });
      const rawCaptions = await db.collection('captions').find({ session_id: sid }).sort({ _id: -1 }).limit(200).toArray();
      rawCaptions.reverse();
      const captions = rawCaptions.map(c => ({ id: c._id, source: c.source, speaker: c.speaker, text: c.text, t_ms: c.t_ms }));
      const flags = await getFlagCounts(sid);
      const requests = await getReqCounts(sid);
      send(ws, {
        type: 'init',
        session: doc(session),
        captions,
        flags,
        requests,
        you: { id: user.id, role: user.role }
      });
      presence(sid);
    })().catch(err => {
      log.error('ws init error', { err: err.message });
      ws.close(1011, 'Internal error');
    });

    const violation = (code) => {
      send(ws, { type: 'error', code });
      if (++ws.bad > 20) ws.close(1008, 'Too many invalid messages');
    };

    ws.on('message', (raw) => {
      (async () => {
        let m; try { m = JSON.parse(raw); } catch { return violation('bad_json'); }
        if (!m || typeof m !== 'object' || typeof m.type !== 'string') return violation('bad_message');
        const now = Date.now();
        if (m.type !== 'speech_chunk') {
          while (ws.rate.length && now - ws.rate[0] > 5000) ws.rate.shift();
          if (ws.rate.length >= (teacher ? 120 : 30)) {
            if (!ws.warned || now - ws.warned > 3000) {
              ws.warned = now;
              send(ws, { type: 'error', code: 'rate_limited' });
            }
            return;
          }
          ws.rate.push(now);
        }
        const s = await db.collection('sessions').findOne({ _id: sid });
        if (!s || s.ended_at) {
          send(ws, { type: 'ended' });
          return ws.close(1000, 'Session ended');
        }

        if (m.type === 'ping') return send(ws, { type: 'pong' });

        if (teacher && m.type === 'speech_chunk') {
          if (typeof m.data !== 'string' || m.data.length > 65536 || !/^[A-Za-z0-9+/]+={0,2}$/.test(m.data)) return violation('bad_audio');
          if (!speechEngine?.isModelInstalled?.()) {
            if (!ws.warnedSpeech) {
              ws.warnedSpeech = true;
              send(ws, { type: 'error', code: 'offline_speech_unavailable' });
            }
            return;
          }
          if (activeStreamingWs && activeStreamingWs !== ws && activeStreamingWs.readyState === 1 && activeStreamingWs.sid !== sid) {
            if (!ws.warnedBusy) {
              ws.warnedBusy = true;
              send(ws, { type: 'error', code: 'offline_speech_busy' });
            }
            return;
          }
          if (activeStreamingWs !== ws) {
            activeStreamingWs = ws;
            speechEngine.reset();
          }
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
            if (now - ws.lastInterim < 100) return;
            ws.lastInterim = now;
            const vocab = await db.collection('vocab').find({ classroom_id: ws.classroomId }).toArray();
            return broadcast(sid, { type: 'interim', speaker, source, text: T.applyVocab(text, vocab) }, ws);
          }
          if (ws.lastFinal.text === text && now - ws.lastFinal.at < 1500) {
            return send(ws, { type: 'ack', cid: m.cid ?? null, id: ws.lastFinal.id, duplicate: true });
          }
          const r = await publishCaption(s, ws.classroomId, { source, speaker, text, userId: user.id, cid: m.cid ?? null });
          ws.lastFinal = { text, at: now, id: r.id };
          return send(ws, { type: 'ack', cid: m.cid ?? null, id: r.id, duplicate: r.duplicate });
        }

        if (!teacher && m.type === 'request') {
          if (!REQUEST_KINDS.has(m.kind)) return violation('bad_request');
          if (ws.cool[m.kind] && now - ws.cool[m.kind] < 3000) return;
          ws.cool[m.kind] = now;
          const reqId = await nextId('requests', db);
          await db.collection('requests').insertOne({
            _id: reqId,
            session_id: sid,
            user_id: user.id,
            kind: m.kind,
            created_at: now
          });
          const counts = await getReqCounts(sid);
          return broadcast(sid, { type: 'request', kind: m.kind, user: user.name, counts });
        }

        if (!teacher && m.type === 'flag') {
          if (!FLAG_KINDS.has(m.kind) || !Number.isInteger(m.captionId)) return violation('bad_flag');
          const cap = await db.collection('captions').findOne({ _id: m.captionId, session_id: sid });
          if (!cap) return violation('bad_flag');
          try {
            const flagId = await nextId('flags', db);
            await db.collection('flags').insertOne({
              _id: flagId,
              session_id: sid,
              caption_id: cap._id,
              user_id: user.id,
              kind: m.kind,
              created_at: now
            });
          } catch (err) {
            if (err.code === 11000) return; // already flagged by this user
            throw err;
          }
          const count = await db.collection('flags').countDocuments({ caption_id: cap._id, kind: m.kind });
          return broadcast(sid, { type: 'flag', captionId: cap._id, kind: m.kind, count });
        }

        violation('not_allowed');
      })().catch((err) => {
        log.error('ws message processing error', { err: err.message });
        violation('internal_error');
      });
    });

    ws.on('close', () => {
      if (activeStreamingWs === ws) {
        activeStreamingWs = null;
        speechEngine?.reset();
      }
      const room = rooms.get(sid);
      room?.delete(ws);
      if (room && !room.size) rooms.delete(sid);
      else presence(sid);
    });
  });

  const beat = setInterval(() => wss.clients.forEach(w => { if (!w.isAlive) return w.terminate(); w.isAlive = false; try { w.ping(); } catch { /* closing */ } }), 30000);
  beat.unref();

  return {
    issueTicket,
    publishCaption,
    broadcast,
    endSession(sid) {
      broadcast(sid, { type: 'ended' });
      setTimeout(() => (rooms.get(sid) || []).forEach(w => w.close(1000, 'Session ended')), 400).unref();
    },
    disconnectUser(userId) {
      for (const room of rooms.values()) {
        for (const w of room) {
          if (w.user.id === userId) w.close(4001, 'Signed out');
        }
      }
    },
    stats: () => ({ rooms: rooms.size, sockets: wss.clients.size }),
    close() {
      clearInterval(beat);
      for (const t of presenceTimers.values()) clearTimeout(t);
      wss.clients.forEach(w => w.close(1001, 'Server restarting'));
      setTimeout(() => wss.clients.forEach(w => w.terminate()), 1500).unref();
    },
  };
}

module.exports = { createHub };
