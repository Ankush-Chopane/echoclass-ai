const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { open } = require('./db');
const T = require('./text');
const S = require('./security');
const log = require('./log');
const LANGS = require('./languages');
const { createHub } = require('./realtime');
const { createSummarizer, AiError } = require('./ai');
const { createTranscriber, TranscribeError } = require('./transcribe');
const { purgeExpired } = require('./retention');
const { createSpeechEngine } = require('./speech-engine');
const os = require('os');
const pkg = require('../package.json');

const now = () => Date.now();
const LANG_CODES = new Set(LANGS.map(l => l[0]));
const RETENTION_CHOICES = [0, 30, 90, 180, 365];
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password-1', 10);
const intParam = (v, def, min, max) => { const n = parseInt(v, 10); return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def; };

function createApp(config, { fetch: fetchImpl, limits = {}, mount, speechEngine: injectedEngine } = {}) {
  const cfg = config;
  const db = open(cfg.databasePath);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy);

  const summarizer = createSummarizer(cfg.ai, fetchImpl);
  const transcriber = createTranscriber(cfg.transcription, fetchImpl);
  const speechEngine = injectedEngine || createSpeechEngine({ modelPath: cfg.voskModelPath, pythonPath: cfg.pythonPath });

  // ---------- prepared statements ----------
  const q = {
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    classroom: db.prepare('SELECT c.*, u.name AS teacher_name FROM classrooms c JOIN users u ON u.id=c.teacher_id WHERE c.id = ?'),
    classByCode: db.prepare('SELECT * FROM classrooms WHERE code = ?'),
    isEnrolled: db.prepare('SELECT 1 FROM enrollments WHERE user_id=? AND classroom_id=?'),
    session: db.prepare('SELECT * FROM sessions WHERE id = ?'),
    activeSession: db.prepare('SELECT * FROM sessions WHERE classroom_id=? AND ended_at IS NULL ORDER BY id DESC LIMIT 1'),
    vocab: db.prepare('SELECT id, heard, replacement FROM vocab WHERE classroom_id=? ORDER BY id'),
    allCaptions: db.prepare('SELECT id, source, speaker, text, t_ms FROM captions WHERE session_id=? ORDER BY id'),
    flagCounts: db.prepare('SELECT caption_id, kind, COUNT(*) AS n FROM flags WHERE session_id=? GROUP BY caption_id, kind'),
    reqCounts: db.prepare('SELECT kind, COUNT(*) AS n FROM requests WHERE session_id=? GROUP BY kind'),
  };
  const loadUser = (id) => q.userById.get(id);
  function access(user, classroomId) {
    const c = q.classroom.get(classroomId);
    if (!c) return null;
    if (user.role === 'teacher' ? c.teacher_id === user.id : q.isEnrolled.get(user.id, c.id)) return c;
    return null;
  }
  const sessionAccess = (user, id) => { const s = q.session.get(id); return s ? { s, c: access(user, s.classroom_id) } : {}; };

  // ---------- middleware ----------
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const bad = (res, code, msg, extra) => res.status(code).json({ error: msg, ...extra });
  app.use(S.securityHeaders({ isProd: cfg.isProd }));
  app.use('/api', (req, res, next) => {            // CORS only for explicitly allowed origins; same-origin needs none
    const o = req.headers.origin;
    if (o && cfg.allowedOrigins.includes(o.replace(/\/+$/, ''))) {
      res.set({ 'Access-Control-Allow-Origin': o, Vary: 'Origin', 'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Audio-Consent, X-Audio-Duration-Ms', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'Access-Control-Max-Age': '600' });
      if (req.method === 'OPTIONS') return res.sendStatus(204);
    }
    next();
  });
  app.use('/api', express.json({ limit: '50kb' }));
  const apiLimit = S.createLimiter({ windowMs: 60_000, max: 600 });
  app.use('/api', apiLimit);
  const registerLimit = S.createLimiter({ windowMs: 15 * 60_000, max: limits.register ?? 12, message: 'Too many sign-up attempts. Try again in a few minutes.' });
  const loginLimit = S.createLimiter({ windowMs: 15 * 60_000, max: limits.login ?? 60, message: 'Too many sign-in attempts. Try again in a few minutes.' });
  const joinLimit = S.createLimiter({ windowMs: 60_000, max: 10, key: (r) => 'join:' + r.user.id, message: 'Too many join attempts. Wait a minute and try again.' });
  const aiLimit = S.createLimiter({ windowMs: 60_000, max: 6, key: (r) => 'ai:' + r.user.id });
  const trLimit = S.createLimiter({ windowMs: 60_000, max: 30, key: (r) => 'tr:' + r.user.id });
  const lock = S.createFailureLock({ windowMs: 15 * 60_000, max: 5 });

  const sign = (u) => jwt.sign({ sub: u.id, role: u.role, tv: u.token_version }, cfg.jwtSecret, { algorithm: 'HS256', expiresIn: cfg.jwtTtlSeconds });
  const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });
  function auth(req, res, next) {
    const h = req.headers.authorization || '';
    try {
      const p = jwt.verify(h.replace(/^Bearer /, ''), cfg.jwtSecret, { algorithms: ['HS256'] });
      const u = loadUser(p.sub);
      if (!u || u.token_version !== p.tv) return bad(res, 401, 'Your session has ended. Please sign in again.', { code: 'session_ended' });
      req.user = { id: u.id, role: u.role, name: u.name, email: u.email }; next();
    } catch (e) { bad(res, 401, e.name === 'TokenExpiredError' ? 'Your session has expired. Please sign in again.' : 'Please sign in.', { code: e.name === 'TokenExpiredError' ? 'expired' : 'unauthenticated' }); }
  }
  const teacherOnly = (req, res, next) => (req.user.role === 'teacher' ? next() : bad(res, 403, 'Only teachers can do that.'));
  const studentOnly = (req, res, next) => (req.user.role === 'student' ? next() : bad(res, 403, 'Only students can do that.'));
  const idParam = (req) => { const n = Number(req.params.id); return Number.isSafeInteger(n) && n > 0 ? n : 0; };

  const server = http.createServer(app);
  const hub = createHub({ db, loadUser, access, server, allowedOrigins: cfg.allowedOrigins, speechEngine });

  // ---------- health + public config ----------
  app.get('/health', (req, res) => {
    try { db.prepare('SELECT 1').get(); res.json({ ok: true, version: pkg.version, uptimeSec: Math.round(process.uptime()), db: 'ok' }); }
    catch { res.status(503).json({ ok: false, db: 'error' }); }
  });
  app.get('/api/config', (req, res) => res.json({
    languages: LANGS, teacherInviteRequired: !!cfg.teacherInviteCode, teacherSignupOpen: cfg.allowOpenTeacherSignup, passwordMinLength: 6,
    aiSummaries: summarizer.enabled, serverTranscription: transcriber.enabled, retentionChoices: RETENTION_CHOICES, defaultRetentionDays: cfg.defaultRetentionDays,
    offlineSpeech: speechEngine.publicStatus(),
  }));
  // LAN addresses are only useful to (and only shown to) a signed-in teacher who is setting up the classroom.
  app.get('/api/system/network', auth, teacherOnly, (req, res) => {
    const ifaces = os.networkInterfaces();
    const localIps = [];
    for (const list of Object.values(ifaces)) {
      for (const net of list || []) {
        if (net.family === 'IPv4' && !net.internal) localIps.push(net.address);
      }
    }
    res.json({
      localIps,
      port: cfg.port,
      host: cfg.host,
      https: cfg.https?.enabled || false,
      httpsPort: cfg.https?.port || 3443,
      speechEngine: speechEngine.publicStatus()
    });
  });

  // ---------- auth ----------
  app.post('/api/auth/register', registerLimit, wrap(async (req, res) => {
    const b = req.body || {};
    const name = S.cleanText(b.name, 60), email = S.normalizeEmail(b.email), role = b.role;
    const errors = {};
    if (name.length < 2) errors.name = 'Enter your name (at least 2 characters).';
    if (!S.validEmail(email)) errors.email = 'Enter a valid email address.';
    const pwErr = S.validatePassword(b.password, { email, name }); if (pwErr) errors.password = pwErr;
    if (role !== 'student' && role !== 'teacher') errors.role = 'Choose student or teacher.';
    if (!errors.role && role === 'teacher') {
      if (cfg.teacherInviteCode) { if (!S.safeEqual(String(b.inviteCode || ''), cfg.teacherInviteCode)) errors.inviteCode = 'That teacher invite code is not correct.'; }
      else if (!cfg.allowOpenTeacherSignup) errors.role = 'Teacher accounts are created by invitation only.';
    }
    if (Object.keys(errors).length) return bad(res, 400, Object.values(errors)[0], { fields: errors });
    if (q.userByEmail.get(email)) return bad(res, 409, 'That email is already registered. Try signing in.', { fields: { email: 'That email is already registered.' } });
    const hash = await bcrypt.hash(b.password, 11);
    let r; try { r = db.prepare('INSERT INTO users(name,email,password_hash,role,created_at) VALUES(?,?,?,?,?)').run(name, email, hash, role, now()); }
    catch { return bad(res, 409, 'That email is already registered.', { fields: { email: 'That email is already registered.' } }); }
    const u = q.userById.get(r.lastInsertRowid);
    S.audit(db, req, 'register', { userId: u.id, detail: role });
    res.status(201).json({ token: sign(u), user: publicUser(u), expiresIn: cfg.jwtTtlSeconds });
  }));

  app.post('/api/auth/login', loginLimit, wrap(async (req, res) => {
    const email = S.normalizeEmail(req.body?.email), password = typeof req.body?.password === 'string' ? req.body.password : '';
    const key = req.ip + '|' + email;
    if (lock.locked(key)) { res.set('Retry-After', String(lock.retryAfter(key))); return bad(res, 429, 'Too many failed sign-in attempts. Try again in a few minutes.'); }
    const u = q.userByEmail.get(email);
    const ok = await bcrypt.compare(password.slice(0, 200), u ? u.password_hash : DUMMY_HASH);   // constant work whether or not the account exists
    if (!u || !ok) { lock.fail(key); S.audit(db, req, 'login_failed', { detail: email.slice(0, 3) + '***' }); return bad(res, 401, 'Wrong email or password.'); }
    lock.clear(key);
    db.prepare('UPDATE users SET last_login_at=? WHERE id=?').run(now(), u.id);
    S.audit(db, req, 'login', { userId: u.id });
    res.json({ token: sign(u), user: publicUser(u), expiresIn: cfg.jwtTtlSeconds });
  }));

  app.get('/api/me', auth, (req, res) => res.json({ ...req.user }));
  app.post('/api/auth/refresh', auth, (req, res) => res.json({ token: sign(q.userById.get(req.user.id)), expiresIn: cfg.jwtTtlSeconds }));
  app.post('/api/auth/logout-all', auth, (req, res) => {         // invalidates every token issued so far, on all devices
    db.prepare('UPDATE users SET token_version = token_version + 1 WHERE id=?').run(req.user.id);
    hub.disconnectUser(req.user.id); S.audit(db, req, 'logout_all'); res.json({ ok: true });
  });
  app.patch('/api/me/password', auth, loginLimit, wrap(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    const u = q.userById.get(req.user.id);
    if (!(await bcrypt.compare(String(currentPassword || '').slice(0, 200), u.password_hash))) return bad(res, 403, 'Your current password is not correct.');
    const err = S.validatePassword(newPassword, { email: u.email, name: u.name }); if (err) return bad(res, 400, err);
    db.prepare('UPDATE users SET password_hash=?, token_version=token_version+1 WHERE id=?').run(await bcrypt.hash(newPassword, 11), u.id);
    hub.disconnectUser(u.id); S.audit(db, req, 'password_changed');
    res.json({ token: sign(q.userById.get(u.id)), expiresIn: cfg.jwtTtlSeconds });
  }));
  app.delete('/api/me', auth, wrap(async (req, res) => {
    const u = q.userById.get(req.user.id);
    if (!(await bcrypt.compare(String(req.body?.password || '').slice(0, 200), u.password_hash))) return bad(res, 403, 'Your password is not correct.');
    if (u.role === 'teacher' && db.prepare('SELECT 1 FROM classrooms WHERE teacher_id=?').get(u.id)) return bad(res, 409, 'Delete your classrooms first (this also deletes their transcripts), then delete your account.');
    db.transaction(() => {
      db.prepare("UPDATE captions SET speaker='Deleted user', user_id=NULL WHERE user_id=?").run(u.id);
      db.prepare('DELETE FROM flags WHERE user_id=?').run(u.id); db.prepare('DELETE FROM requests WHERE user_id=?').run(u.id);
      db.prepare('DELETE FROM enrollments WHERE user_id=?').run(u.id); db.prepare('DELETE FROM users WHERE id=?').run(u.id);
    })();
    hub.disconnectUser(u.id); S.audit(db, req, 'account_deleted', { userId: u.id });
    res.json({ ok: true });
  }));

  // ---------- dashboard ----------
  app.get('/api/dashboard', auth, (req, res) => {
    const teacher = req.user.role === 'teacher', uid = req.user.id;
    const classes = teacher
      ? db.prepare(`SELECT c.id, c.name, c.subject, c.language, c.code, c.retention_days,
          (SELECT COUNT(*) FROM enrollments WHERE classroom_id=c.id) students,
          (SELECT COUNT(*) FROM sessions WHERE classroom_id=c.id AND ended_at IS NOT NULL) lectures,
          (SELECT id FROM sessions WHERE classroom_id=c.id AND ended_at IS NULL ORDER BY id DESC LIMIT 1) live
        FROM classrooms c WHERE c.teacher_id=? ORDER BY c.id DESC`).all(uid)
      : db.prepare(`SELECT c.id, c.name, c.subject, c.language, u.name teacher_name,
          (SELECT COUNT(*) FROM sessions WHERE classroom_id=c.id AND ended_at IS NOT NULL) lectures,
          (SELECT id FROM sessions WHERE classroom_id=c.id AND ended_at IS NULL ORDER BY id DESC LIMIT 1) live
        FROM classrooms c JOIN enrollments e ON e.classroom_id=c.id JOIN users u ON u.id=c.teacher_id WHERE e.user_id=? ORDER BY c.id DESC`).all(uid);
    const scope = teacher ? 'c.teacher_id = ?' : 'c.id IN (SELECT classroom_id FROM enrollments WHERE user_id = ?)';
    const recent = db.prepare(`SELECT s.id, s.title, s.started_at, s.ended_at, c.id classroom_id, c.name classroom_name,
        (SELECT COUNT(*) FROM captions WHERE session_id=s.id) captions,
        (SELECT COUNT(DISTINCT x.user_id) FROM (SELECT user_id FROM captions WHERE session_id=s.id AND user_id IS NOT NULL AND source IN ('sign','student')
            UNION SELECT user_id FROM requests WHERE session_id=s.id UNION SELECT user_id FROM flags WHERE session_id=s.id) x) participants,
        EXISTS(SELECT 1 FROM ai_summaries WHERE session_id=s.id) has_ai
      FROM sessions s JOIN classrooms c ON c.id=s.classroom_id WHERE ${scope} AND s.ended_at IS NOT NULL ORDER BY s.started_at DESC LIMIT 8`).all(uid);
    const out = { role: req.user.role, classrooms: classes, recent, live: classes.filter(c => c.live).map(c => ({ classroom_id: c.id, name: c.name, session_id: c.live })) };
    if (teacher) out.totals = { classrooms: classes.length, students: db.prepare('SELECT COUNT(DISTINCT e.user_id) n FROM enrollments e JOIN classrooms c ON c.id=e.classroom_id WHERE c.teacher_id=?').get(uid).n, lectures: classes.reduce((n, c) => n + c.lectures, 0) };
    res.json(out);
  });

  // ---------- classrooms ----------
  const classroomView = (c, teacher) => ({ id: c.id, name: c.name, subject: c.subject, language: c.language, teacher_name: c.teacher_name, created_at: c.created_at, ...(teacher ? { code: c.code, retention_days: c.retention_days } : {}) });
  const retentionOk = (v) => v === null || v === undefined || (Number.isInteger(v) && v >= 0 && v <= 3650);
  app.get('/api/classrooms', auth, (req, res) => {
    const teacher = req.user.role === 'teacher';
    const rows = teacher ? db.prepare('SELECT c.*, u.name teacher_name FROM classrooms c JOIN users u ON u.id=c.teacher_id WHERE teacher_id=? ORDER BY c.id DESC').all(req.user.id)
      : db.prepare('SELECT c.*, u.name teacher_name FROM classrooms c JOIN enrollments e ON e.classroom_id=c.id JOIN users u ON u.id=c.teacher_id WHERE e.user_id=? ORDER BY c.id DESC').all(req.user.id);
    res.json(rows.map(c => ({ ...classroomView(c, teacher), live: q.activeSession.get(c.id)?.id || null, students: db.prepare('SELECT COUNT(*) n FROM enrollments WHERE classroom_id=?').get(c.id).n })));
  });
  app.post('/api/classrooms', auth, teacherOnly, (req, res) => {
    const name = S.cleanText(req.body?.name, 80), subject = S.cleanText(req.body?.subject, 80), language = req.body?.language || 'en-IN';
    if (name.length < 2) return bad(res, 400, 'Give the classroom a name (at least 2 characters).');
    if (!LANG_CODES.has(language)) return bad(res, 400, 'Choose a supported teaching language.');
    let code, r;
    for (let i = 0; i < 5 && !r; i++) { code = S.randomCode(8); try { r = db.prepare('INSERT INTO classrooms(name,subject,code,teacher_id,language,created_at) VALUES(?,?,?,?,?,?)').run(name, subject, code, req.user.id, language, now()); } catch { /* code clash – retry */ } }
    if (!r) return bad(res, 500, 'Could not create a unique join code. Try again.');
    S.audit(db, req, 'classroom_created', { detail: String(r.lastInsertRowid) });
    res.status(201).json(classroomView(q.classroom.get(r.lastInsertRowid), true));
  });
  app.post('/api/classrooms/join', auth, studentOnly, joinLimit, (req, res) => {
    const code = String(req.body?.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const c = code.length >= 6 && code.length <= 8 ? q.classByCode.get(code) : null;
    if (!c) return bad(res, 404, 'No classroom has that code. Check it with your teacher.');
    db.prepare('INSERT OR IGNORE INTO enrollments(user_id,classroom_id,joined_at) VALUES(?,?,?)').run(req.user.id, c.id, now());
    S.audit(db, req, 'joined_classroom', { detail: String(c.id) });
    res.json(classroomView(q.classroom.get(c.id), false));
  });
  app.get('/api/classrooms/:id', auth, (req, res) => {
    const c = access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    const teacher = req.user.role === 'teacher';
    const live = q.activeSession.get(c.id);
    res.json({ ...classroomView(c, teacher), live: live ? { id: live.id, title: live.title } : null, vocab: q.vocab.all(c.id),
      roster: teacher ? db.prepare('SELECT u.id,u.name,u.email,e.joined_at FROM enrollments e JOIN users u ON u.id=e.user_id WHERE e.classroom_id=? ORDER BY u.name').all(c.id) : undefined });
  });
  app.patch('/api/classrooms/:id', auth, teacherOnly, (req, res) => {
    const c = access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    const b = req.body || {}, name = b.name !== undefined ? S.cleanText(b.name, 80) : c.name, subject = b.subject !== undefined ? S.cleanText(b.subject, 80) : c.subject;
    const language = b.language ?? c.language, retention = b.retention_days === undefined ? c.retention_days : b.retention_days;
    if (name.length < 2) return bad(res, 400, 'The name must be at least 2 characters.');
    if (!LANG_CODES.has(language)) return bad(res, 400, 'Choose a supported teaching language.');
    if (!retentionOk(retention)) return bad(res, 400, 'Retention must be 0 (keep) or a number of days up to 3650.');
    db.prepare('UPDATE classrooms SET name=?, subject=?, language=?, retention_days=? WHERE id=?').run(name, subject, language, retention || null, c.id);
    S.audit(db, req, 'classroom_updated', { detail: String(c.id) });
    res.json(classroomView(q.classroom.get(c.id), true));
  });
  app.post('/api/classrooms/:id/rotate-code', auth, teacherOnly, (req, res) => {
    const c = access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    for (let i = 0; i < 5; i++) { try { db.prepare('UPDATE classrooms SET code=? WHERE id=?').run(S.randomCode(8), c.id); break; } catch { /* clash */ } }
    S.audit(db, req, 'code_rotated', { detail: String(c.id) });
    res.json({ code: q.classroom.get(c.id).code });
  });
  app.delete('/api/classrooms/:id', auth, teacherOnly, (req, res) => {
    const c = access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    const live = q.activeSession.get(c.id); if (live) hub.endSession(live.id);
    db.prepare('DELETE FROM classrooms WHERE id=?').run(c.id);
    S.audit(db, req, 'classroom_deleted', { detail: String(c.id) });
    res.json({ ok: true });
  });
  app.delete('/api/classrooms/:id/membership', auth, studentOnly, (req, res) => {
    const c = access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    db.prepare('DELETE FROM enrollments WHERE user_id=? AND classroom_id=?').run(req.user.id, c.id); hub.disconnectUser(req.user.id);
    res.json({ ok: true });
  });
  app.delete('/api/classrooms/:id/students/:uid', auth, teacherOnly, (req, res) => {
    const c = access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    db.prepare('DELETE FROM enrollments WHERE user_id=? AND classroom_id=?').run(Number(req.params.uid), c.id); res.json({ ok: true });
  });

  app.post('/api/classrooms/:id/vocab', auth, teacherOnly, (req, res) => {
    const c = access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    const heard = S.cleanText(req.body?.heard, 60), replacement = S.cleanText(req.body?.replacement, 80);
    if (!heard || !replacement) return bad(res, 400, 'Both fields are required.');
    if (db.prepare('SELECT COUNT(*) n FROM vocab WHERE classroom_id=?').get(c.id).n >= 300) return bad(res, 400, 'This classroom already has the maximum of 300 corrections.');
    db.prepare('INSERT INTO vocab(classroom_id,heard,replacement) VALUES(?,?,?) ON CONFLICT(classroom_id,heard) DO UPDATE SET replacement=excluded.replacement').run(c.id, heard, replacement);
    res.json(q.vocab.all(c.id));
  });
  app.delete('/api/classrooms/:id/vocab/:vid', auth, teacherOnly, (req, res) => {
    const c = access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    db.prepare('DELETE FROM vocab WHERE id=? AND classroom_id=?').run(Number(req.params.vid), c.id); res.json(q.vocab.all(c.id));
  });

  // ---------- lectures: list, search ----------
  const ftsQuery = (term) => { const ws = T.words(term).filter(w => !/'/.test(w)).slice(0, 6); return ws.length ? ws.map((w, i) => `"${w}"${i === ws.length - 1 ? '*' : ''}`).join(' ') : null; };
  const likeEsc = (s) => s.replace(/[%_\\]/g, m => '\\' + m);
  app.get('/api/classrooms/:id/sessions', auth, (req, res) => {
    const c = access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    const page = intParam(req.query.page, 1, 1, 100000), size = intParam(req.query.pageSize, 10, 1, 50);
    const term = S.cleanText(req.query.q, 80), from = Number(req.query.from) || 0, to = Number(req.query.to) || 0;
    const where = ['s.classroom_id = ?'], args = [c.id];
    if (term) { const fts = ftsQuery(term); where.push(`(s.title LIKE ? ESCAPE '\\' ${fts ? 'OR s.id IN (SELECT cp.session_id FROM captions_fts f JOIN captions cp ON cp.id=f.rowid WHERE captions_fts MATCH ? AND cp.session_id IN (SELECT id FROM sessions WHERE classroom_id=?))' : ''})`); args.push('%' + likeEsc(term) + '%'); if (fts) args.push(fts, c.id); }
    if (from) { where.push('s.started_at >= ?'); args.push(from); }
    if (to) { where.push('s.started_at <= ?'); args.push(to); }
    const W = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) n FROM sessions s WHERE ${W}`).get(...args).n;
    const items = db.prepare(`SELECT s.id, s.title, s.started_at, s.ended_at, (SELECT COUNT(*) FROM captions WHERE session_id=s.id) captions, EXISTS(SELECT 1 FROM ai_summaries WHERE session_id=s.id) has_ai
      FROM sessions s WHERE ${W} ORDER BY s.started_at DESC LIMIT ? OFFSET ?`).all(...args, size, (page - 1) * size);
    res.json({ items, total, page, pageSize: size, pages: Math.max(1, Math.ceil(total / size)) });
  });
  app.get('/api/classrooms/:id/search', auth, (req, res) => {
    const c = access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    const fts = ftsQuery(S.cleanText(req.query.q, 80)); if (!fts) return res.json({ items: [], total: 0, page: 1, pageSize: 20 });
    const page = intParam(req.query.page, 1, 1, 1000), size = intParam(req.query.pageSize, 20, 1, 50);
    const base = 'FROM captions_fts f JOIN captions cp ON cp.id=f.rowid JOIN sessions s ON s.id=cp.session_id WHERE captions_fts MATCH ? AND s.classroom_id=?';
    const total = db.prepare(`SELECT COUNT(*) n ${base}`).get(fts, c.id).n;
    const items = db.prepare(`SELECT cp.id, cp.session_id, cp.text, cp.speaker, cp.t_ms, s.title ${base} ORDER BY cp.id DESC LIMIT ? OFFSET ?`).all(fts, c.id, size, (page - 1) * size);
    res.json({ items, total, page, pageSize: size });
  });

  // ---------- sessions ----------
  app.post('/api/classrooms/:id/sessions', auth, teacherOnly, (req, res) => {
    const c = access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    let s = q.activeSession.get(c.id);
    if (!s) {
      const title = S.cleanText(req.body?.title, 100) || `${c.name} – ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
      s = q.session.get(db.prepare('INSERT INTO sessions(classroom_id,title,started_at) VALUES(?,?,?)').run(c.id, title, now()).lastInsertRowid);
      S.audit(db, req, 'session_started', { detail: String(s.id) });
    }
    res.json(s);
  });
  app.post('/api/sessions/:id/end', auth, teacherOnly, (req, res) => {
    const { s, c } = sessionAccess(req.user, idParam(req)); if (!s || !c) return bad(res, 404, 'Lesson not found.');
    if (!s.ended_at) { db.prepare('UPDATE sessions SET ended_at=? WHERE id=?').run(now(), s.id); S.audit(db, req, 'session_ended', { detail: String(s.id) }); }
    hub.endSession(s.id);
    res.json(q.session.get(s.id));
  });
  app.delete('/api/sessions/:id', auth, teacherOnly, (req, res) => {
    const { s, c } = sessionAccess(req.user, idParam(req)); if (!s || !c) return bad(res, 404, 'Lesson not found.');
    if (!s.ended_at) hub.endSession(s.id);
    db.prepare('DELETE FROM sessions WHERE id=?').run(s.id); S.audit(db, req, 'session_deleted', { detail: String(s.id) });
    res.json({ ok: true });
  });
  app.post('/api/sessions/:id/ws-ticket', auth, (req, res) => {
    const { s, c } = sessionAccess(req.user, idParam(req)); if (!s || !c) return bad(res, 404, 'Lesson not found.');
    if (s.ended_at) return bad(res, 410, 'This lesson has ended.', { code: 'ended' });
    res.json({ ticket: hub.issueTicket(req.user, s.id), expiresInSec: 30 });
  });
  app.get('/api/sessions/:id', auth, (req, res) => {
    const { s, c } = sessionAccess(req.user, idParam(req)); if (!s || !c) return bad(res, 404, 'Lesson not found.');
    const caps = q.allCaptions.all(s.id);
    const cached = db.prepare('SELECT content, created_at, model, provider, input_hash FROM ai_summaries WHERE session_id=?').get(s.id);
    const confusing = db.prepare(`SELECT cp.id, cp.text, cp.t_ms, COUNT(*) n FROM flags f JOIN captions cp ON cp.id=f.caption_id WHERE f.session_id=? AND f.kind='confusing' GROUP BY cp.id ORDER BY n DESC, cp.id LIMIT 5`).all(s.id);
    res.json({ session: s, classroom: { id: c.id, name: c.name, language: c.language }, requests: Object.fromEntries(q.reqCounts.all(s.id).map(r => [r.kind, r.n])),
      summary: T.summarize(caps), confusing, captionCount: caps.length,
      ai: { available: summarizer.enabled, cached: cached ? { ...JSON.parse(cached.content), generatedAt: cached.created_at, model: cached.model } : null } });
  });
  app.get('/api/sessions/:id/captions', auth, (req, res) => {
    const { s, c } = sessionAccess(req.user, idParam(req)); if (!s || !c) return bad(res, 404, 'Lesson not found.');
    const limit = intParam(req.query.limit, 200, 1, 500), after = intParam(req.query.after, 0, 0, Number.MAX_SAFE_INTEGER);
    const fts = req.query.q ? ftsQuery(S.cleanText(req.query.q, 80)) : null;
    const items = fts
      ? db.prepare('SELECT cp.id, cp.source, cp.speaker, cp.text, cp.t_ms FROM captions_fts f JOIN captions cp ON cp.id=f.rowid WHERE captions_fts MATCH ? AND cp.session_id=? AND cp.id>? ORDER BY cp.id LIMIT ?').all(fts, s.id, after, limit)
      : db.prepare('SELECT id, source, speaker, text, t_ms FROM captions WHERE session_id=? AND id>? ORDER BY id LIMIT ?').all(s.id, after, limit);
    const flags = {}; for (const f of q.flagCounts.all(s.id)) (flags[f.caption_id] ||= {})[f.kind] = f.n;
    res.json({ items, flags, nextAfter: items.length === limit ? items[items.length - 1].id : null });
  });
  app.get('/api/sessions/:id/export', auth, (req, res) => {
    const { s, c } = sessionAccess(req.user, idParam(req)); if (!s || !c) return bad(res, 404, 'Lesson not found.');
    const caps = q.allCaptions.all(s.id), fmt = String(req.query.format || 'txt');
    const base = S.safeFilename(s.title);
    const out = { srt: ['application/x-subrip', () => T.toSRT(caps)], vtt: ['text/vtt', () => T.toVTT(caps)], json: ['application/json', () => JSON.stringify({ session: s, captions: caps, summary: T.summarize(caps) }, null, 2)], txt: ['text/plain', () => T.toTXT(caps, s.title)] }[fmt];
    if (!out) return bad(res, 400, 'Format must be txt, srt, vtt or json.');
    res.type(out[0]).set('Content-Disposition', `attachment; filename="${base}.${fmt}"`).send(out[1]());
  });

  // ---------- optional AI summary ----------
  const aiErr = (res, e) => {
    if (e instanceof AiError) return bad(res, e.status, e.message, { code: e.code, fallback: 'The automatic (extractive) summary is still available.' });
    log.error('ai failure', { err: e.message }); return bad(res, 500, 'The AI summary could not be generated.');
  };
  app.get('/api/sessions/:id/ai-summary', auth, (req, res) => {
    const { s, c } = sessionAccess(req.user, idParam(req)); if (!s || !c) return bad(res, 404, 'Lesson not found.');
    const row = db.prepare('SELECT content, created_at, model, provider FROM ai_summaries WHERE session_id=?').get(s.id);
    res.json({ available: summarizer.enabled, cached: row ? { ...JSON.parse(row.content), generatedAt: row.created_at, model: row.model } : null, label: 'AI-generated from the lecture transcript. It may contain mistakes – check it against the transcript.' });
  });
  app.post('/api/sessions/:id/ai-summary', auth, teacherOnly, aiLimit, wrap(async (req, res) => {
    const { s, c } = sessionAccess(req.user, idParam(req)); if (!s || !c) return bad(res, 404, 'Lesson not found.');
    if (!summarizer.enabled) return bad(res, 501, 'AI summaries are not configured on this server. The automatic summary is still available.', { code: 'not_configured' });
    if (!s.ended_at) return bad(res, 409, 'End the lesson before generating a summary.');
    if (req.body?.confirmExternal !== true) return bad(res, 400, 'Confirm that the lecture transcript may be sent to the configured AI provider.', { code: 'consent_required' });
    const { text, truncated, lines } = T.transcriptForAi(q.allCaptions.all(s.id), cfg.ai.maxInputChars);
    const hash = summarizer.hash(text), cached = db.prepare('SELECT * FROM ai_summaries WHERE session_id=?').get(s.id);
    if (cached && cached.input_hash === hash && !req.body?.force) return res.json({ cached: true, truncated, ...JSON.parse(cached.content), generatedAt: cached.created_at, model: cached.model });
    if (cached && now() - cached.created_at < 60_000) return bad(res, 429, 'A summary was just generated. Wait a minute before regenerating.');
    if (lines === 0) return bad(res, 422, 'There are no teacher captions to summarise.', { code: 'too_short' });
    const day = new Date().toISOString().slice(0, 10);
    const used = db.transaction(() => { db.prepare('INSERT OR IGNORE INTO ai_usage(day,calls) VALUES(?,0)').run(day); const r = db.prepare('SELECT calls FROM ai_usage WHERE day=?').get(day); if (r.calls >= cfg.ai.dailyLimit) return false; db.prepare('UPDATE ai_usage SET calls=calls+1 WHERE day=?').run(day); return true; })();
    if (!used) return bad(res, 429, 'The daily AI summary limit for this server has been reached. Try again tomorrow.', { code: 'daily_limit' });
    const t0 = now();
    try {
      const result = await summarizer.summarize(text, { title: s.title });
      db.prepare('INSERT INTO ai_summaries(session_id,content,input_hash,provider,model,created_at,created_by) VALUES(?,?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET content=excluded.content,input_hash=excluded.input_hash,provider=excluded.provider,model=excluded.model,created_at=excluded.created_at,created_by=excluded.created_by')
        .run(s.id, JSON.stringify(result), hash, summarizer.provider, summarizer.model, now(), req.user.id);
      S.audit(db, req, 'ai_summary', { detail: `session ${s.id}` }); log.info('ai summary', { session: s.id, ms: now() - t0, truncated });
      res.json({ cached: false, truncated, ...result, generatedAt: now(), model: summarizer.model });
    } catch (e) { log.warn('ai summary failed', { session: s.id, code: e.code, ms: now() - t0 }); aiErr(res, e); }
  }));

  // ---------- optional server-side transcription ----------
  const audioTypes = ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4'];
  app.post('/api/sessions/:id/transcribe', auth, teacherOnly, trLimit, express.raw({ type: audioTypes, limit: cfg.transcription.maxBytes + 1024 }), wrap(async (req, res) => {
    const { s, c } = sessionAccess(req.user, idParam(req)); if (!s || !c) return bad(res, 404, 'Lesson not found.');
    if (!transcriber.enabled) return bad(res, 501, 'Server-side transcription is not configured. Browser speech recognition and typed captions still work.', { code: 'not_configured' });
    if (s.ended_at) return bad(res, 410, 'This lesson has ended.');
    if (String(req.headers['x-audio-consent'] || '').toLowerCase() !== 'yes') return bad(res, 400, 'Audio consent is required: send header X-Audio-Consent: yes after the teacher agrees to upload audio to the transcription provider.', { code: 'consent_required' });
    if (!Buffer.isBuffer(req.body)) return bad(res, 415, 'Send the audio as the raw request body with an audio/* Content-Type.');
    const declared = req.headers['x-audio-duration-ms'] != null ? Number(req.headers['x-audio-duration-ms']) : null;
    try {
      const raw = await transcriber.transcribe(req.body, req.headers['content-type'], { language: c.language, declaredMs: declared });
      const text = T.applyVocab(raw.text, q.vocab.all(c.id));
      if (!text) return res.json({ text: '', published: false });
      let published = false;
      if (req.query.broadcast === '1') { hub.publishCaption(s, c.id, { source: 'speech', speaker: req.user.name, text, userId: req.user.id }); published = true; }
      res.json({ text, published });
    } catch (e) {
      if (e instanceof TranscribeError) return bad(res, e.status, e.message, { code: e.code });
      throw e;
    }
  }));

  if (mount) mount(app, { auth, wrap });   // test/embedding hook: extra routes that run before the 404 + error handlers

  // ---------- static app (built React classroom app) ----------
  // MediaPipe's WASM runtime is served from the installed npm package so the camera works without a CDN.
  let mediapipeDir = null;
  try { mediapipeDir = path.dirname(require.resolve('@mediapipe/tasks-vision/package.json')); } catch { try { mediapipeDir = path.dirname(require.resolve('@mediapipe/tasks-vision')); } catch { /* not installed */ } }
  if (mediapipeDir) app.use('/vendor/mediapipe', express.static(mediapipeDir, { maxAge: '7d', index: false }));
  const indexFile = path.join(cfg.staticDir, 'index.html');
  const hasFrontend = fs.existsSync(indexFile);
  if (hasFrontend) {
    app.use(express.static(cfg.staticDir, { index: false, setHeaders: (res, p) => { res.set('Cache-Control', /[\\/]assets[\\/]/.test(p) ? 'public, max-age=31536000, immutable' : 'no-cache'); } }));
  }
  app.use('/api', (req, res) => bad(res, 404, 'Not found.'));
  // Single-page-app fallback: client-side routes such as /classrooms/3/live must return index.html, not 404.
  app.get(/^\/(?!api\/|ws(\/|$)|health$|vendor\/).*/, (req, res, next) => {
    if (/\.[a-z0-9]{1,8}$/i.test(req.path)) return next();                      // a missing file is a real 404
    if (!hasFrontend) return res.status(503).type('text/plain').send('EchoClass API is running, but the classroom web app has not been built. Run: npm run build:classroom (or use the Vite dev server on port 5173).');
    res.set('Cache-Control', 'no-cache').sendFile(indexFile);
  });
  app.use((err, req, res, next) => {     // eslint-disable-line no-unused-vars
    if (err.type === 'entity.parse.failed') return bad(res, 400, 'The request body is not valid JSON.');
    if (err.type === 'entity.too.large') return bad(res, 413, 'The request is too large.');
    if (err.status && err.status < 500) return bad(res, err.status, err.message);
    log.error('unhandled', { path: req.path, err: err.message, stack: cfg.isProd ? undefined : err.stack });
    bad(res, 500, 'Something went wrong on our side. Please try again.');
  });

  // ---------- lifecycle ----------
  const purgeTimer = setInterval(() => { try { purgeExpired(db, cfg.defaultRetentionDays); } catch (e) { log.error('purge failed', { err: e.message }); } }, 6 * 3600_000); purgeTimer.unref();
  server.requestTimeout = 60_000; server.headersTimeout = 20_000; server.keepAliveTimeout = 65_000;
  let closed = false;
  const close = () => new Promise((resolve) => {
    if (closed) return resolve(); closed = true;
    clearInterval(purgeTimer); [apiLimit, registerLimit, loginLimit, joinLimit, aiLimit, trLimit].forEach(l => l.stop());
    try { speechEngine.close(); } catch { /* ignore */ }
    hub.close();
    const done = () => { try { db.close(); } catch { /* already closed */ } resolve(); };
    if (!server.listening) return done();
    server.close(done); server.closeIdleConnections?.(); setTimeout(() => { server.closeAllConnections?.(); }, 2000).unref();
  });
  return { app, server, db, hub, speechEngine, close, config: cfg, purge: () => purgeExpired(db, cfg.defaultRetentionDays) };
}
module.exports = { createApp };