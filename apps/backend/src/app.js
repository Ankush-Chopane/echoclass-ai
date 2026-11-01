const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { connect, nextId, close: closeDb } = require('./db');
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
const idParam = (req) => { const n = Number(req.params.id); return Number.isSafeInteger(n) && n > 0 ? n : 0; };
const doc = (d) => {
  if (!d) return null;
  if (d.id !== undefined && d._id === undefined) return d;
  const { _id, ...rest } = d;
  return { id: _id, ...rest };
};
const docs = (arr) => (arr || []).map(doc);
const classroomView = (c, teacher) => ({
  id: c._id ?? c.id,
  name: c.name,
  subject: c.subject,
  language: c.language,
  teacher_name: c.teacher_name,
  created_at: c.created_at,
  ...(teacher ? { code: c.code, retention_days: c.retention_days } : {})
});
const retentionOk = (v) => v === null || v === undefined || (Number.isInteger(v) && v >= 0 && v <= 3650);

async function createApp(config, { fetch: fetchImpl, limits = {}, mount, speechEngine: injectedEngine, db: injectedDb } = {}) {
  const cfg = config;
  const db = injectedDb || await connect(cfg.mongoUri);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', cfg.trustProxy);

  const summarizer = createSummarizer(cfg.ai, fetchImpl);
  const transcriber = createTranscriber(cfg.transcription, fetchImpl);
  const speechEngine = injectedEngine || createSpeechEngine({ modelPath: cfg.voskModelPath, pythonPath: cfg.pythonPath });

  const loadUser = async (id) => db.collection('users').findOne({ _id: id });

  async function access(user, classroomId) {
    const c = await db.collection('classrooms').findOne({ _id: classroomId });
    if (!c) return null;
    const teacher = await db.collection('users').findOne({ _id: c.teacher_id });
    const cWithTeacher = { ...c, teacher_name: teacher ? teacher.name : '' };
    if (user.role === 'teacher') {
      return c.teacher_id === (user.id ?? user._id) ? cWithTeacher : null;
    }
    const isEnrolled = await db.collection('enrollments').findOne({ user_id: (user.id ?? user._id), classroom_id: c._id });
    return isEnrolled ? cWithTeacher : null;
  }

  async function sessionAccess(user, id) {
    const s = await db.collection('sessions').findOne({ _id: id });
    if (!s) return {};
    const c = await access(user, s.classroom_id);
    return { s: doc(s), c };
  }

  // ---------- middleware ----------
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const bad = (res, code, msg, extra) => res.status(code).json({ error: msg, ...extra });

  app.use(S.securityHeaders({ isProd: cfg.isProd }));
  app.use('/api', (req, res, next) => {
    const o = req.headers.origin;
    if (o && cfg.allowedOrigins.includes(o.replace(/\/+$/, ''))) {
      res.set({
        'Access-Control-Allow-Origin': o,
        Vary: 'Origin',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Audio-Consent, X-Audio-Duration-Ms',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Access-Control-Max-Age': '600'
      });
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

  const sign = (u) => jwt.sign({ sub: u.id ?? u._id, role: u.role, tv: u.token_version ?? 0 }, cfg.jwtSecret, { algorithm: 'HS256', expiresIn: cfg.jwtTtlSeconds });
  const publicUser = (u) => ({ id: u.id ?? u._id, name: u.name, email: u.email, role: u.role });

  async function auth(req, res, next) {
    const h = req.headers.authorization || '';
    try {
      const p = jwt.verify(h.replace(/^Bearer /, ''), cfg.jwtSecret, { algorithms: ['HS256'] });
      const u = await loadUser(p.sub);
      if (!u || (u.token_version ?? 0) !== p.tv) {
        return bad(res, 401, 'Your session has ended. Please sign in again.', { code: 'session_ended' });
      }
      req.user = { id: u._id, role: u.role, name: u.name, email: u.email };
      next();
    } catch (e) {
      bad(res, 401, e.name === 'TokenExpiredError' ? 'Your session has expired. Please sign in again.' : 'Please sign in.', {
        code: e.name === 'TokenExpiredError' ? 'expired' : 'unauthenticated'
      });
    }
  }
  const authMw = (req, res, next) => auth(req, res, next).catch(next);
  const teacherOnly = (req, res, next) => (req.user.role === 'teacher' ? next() : bad(res, 403, 'Only teachers can do that.'));
  const studentOnly = (req, res, next) => (req.user.role === 'student' ? next() : bad(res, 403, 'Only students can do that.'));

  const server = http.createServer(app);
  const hub = await createHub({ db, loadUser, access, server, allowedOrigins: cfg.allowedOrigins, speechEngine });

  // ---------- health + public config ----------
  app.get('/health', wrap(async (req, res) => {
    try {
      await db.command({ ping: 1 });
      res.json({ ok: true, version: pkg.version, uptimeSec: Math.round(process.uptime()), db: 'ok' });
    } catch {
      res.status(503).json({ ok: false, db: 'error' });
    }
  }));

  app.get('/api/config', (req, res) => res.json({
    languages: LANGS,
    teacherInviteRequired: !!cfg.teacherInviteCode,
    teacherSignupOpen: cfg.allowOpenTeacherSignup,
    passwordMinLength: 6,
    aiSummaries: summarizer.enabled,
    serverTranscription: transcriber.enabled,
    retentionChoices: RETENTION_CHOICES,
    defaultRetentionDays: cfg.defaultRetentionDays,
    offlineSpeech: speechEngine.publicStatus(),
  }));

  app.get('/api/system/network', authMw, teacherOnly, (req, res) => {
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

    const existing = await db.collection('users').findOne({ email });
    if (existing) return bad(res, 409, 'That email is already registered. Try signing in.', { fields: { email: 'That email is already registered.' } });

    const hash = await bcrypt.hash(b.password, 11);
    const id = await nextId('users', db);
    const userDoc = {
      _id: id,
      name,
      email,
      password_hash: hash,
      role,
      token_version: 0,
      last_login_at: null,
      created_at: now()
    };
    try {
      await db.collection('users').insertOne(userDoc);
    } catch (e) {
      if (e.code === 11000) return bad(res, 409, 'That email is already registered.', { fields: { email: 'That email is already registered.' } });
      throw e;
    }
    const u = doc(userDoc);
    await S.audit(db, req, 'register', { userId: u.id, detail: role });
    res.status(201).json({ token: sign(u), user: publicUser(u), expiresIn: cfg.jwtTtlSeconds });
  }));

  app.post('/api/auth/login', loginLimit, wrap(async (req, res) => {
    const email = S.normalizeEmail(req.body?.email), password = typeof req.body?.password === 'string' ? req.body.password : '';
    const key = req.ip + '|' + email;
    if (lock.locked(key)) { res.set('Retry-After', String(lock.retryAfter(key))); return bad(res, 429, 'Too many failed sign-in attempts. Try again in a few minutes.'); }
    const uDoc = await db.collection('users').findOne({ email });
    const ok = await bcrypt.compare(password.slice(0, 200), uDoc ? uDoc.password_hash : DUMMY_HASH);
    if (!uDoc || !ok) {
      lock.fail(key);
      await S.audit(db, req, 'login_failed', { detail: email.slice(0, 3) + '***' });
      return bad(res, 401, 'Wrong email or password.');
    }
    lock.clear(key);
    await db.collection('users').updateOne({ _id: uDoc._id }, { $set: { last_login_at: now() } });
    const u = doc(uDoc);
    await S.audit(db, req, 'login', { userId: u.id });
    res.json({ token: sign(u), user: publicUser(u), expiresIn: cfg.jwtTtlSeconds });
  }));

  app.get('/api/me', authMw, (req, res) => res.json({ ...req.user }));

  app.post('/api/auth/refresh', authMw, wrap(async (req, res) => {
    const u = await loadUser(req.user.id);
    res.json({ token: sign(doc(u)), expiresIn: cfg.jwtTtlSeconds });
  }));

  app.post('/api/auth/logout-all', authMw, wrap(async (req, res) => {
    await db.collection('users').updateOne({ _id: req.user.id }, { $inc: { token_version: 1 } });
    hub.disconnectUser(req.user.id);
    await S.audit(db, req, 'logout_all');
    res.json({ ok: true });
  }));

  app.patch('/api/me/password', authMw, loginLimit, wrap(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    const u = await loadUser(req.user.id);
    if (!(await bcrypt.compare(String(currentPassword || '').slice(0, 200), u.password_hash))) return bad(res, 403, 'Your current password is not correct.');
    const err = S.validatePassword(newPassword, { email: u.email, name: u.name }); if (err) return bad(res, 400, err);
    const hash = await bcrypt.hash(newPassword, 11);
    await db.collection('users').updateOne({ _id: u._id }, { $set: { password_hash: hash }, $inc: { token_version: 1 } });
    hub.disconnectUser(u._id);
    await S.audit(db, req, 'password_changed');
    const updated = await loadUser(u._id);
    res.json({ token: sign(doc(updated)), expiresIn: cfg.jwtTtlSeconds });
  }));

  app.delete('/api/me', authMw, wrap(async (req, res) => {
    const u = await loadUser(req.user.id);
    if (!(await bcrypt.compare(String(req.body?.password || '').slice(0, 200), u.password_hash))) return bad(res, 403, 'Your password is not correct.');
    if (u.role === 'teacher') {
      const hasClassrooms = await db.collection('classrooms').countDocuments({ teacher_id: u._id });
      if (hasClassrooms > 0) return bad(res, 409, 'Delete your classrooms first (this also deletes their transcripts), then delete your account.');
    }
    await db.collection('captions').updateMany({ user_id: u._id }, { $set: { speaker: 'Deleted user', user_id: null } });
    await db.collection('flags').deleteMany({ user_id: u._id });
    await db.collection('requests').deleteMany({ user_id: u._id });
    await db.collection('enrollments').deleteMany({ user_id: u._id });
    await db.collection('users').deleteOne({ _id: u._id });
    hub.disconnectUser(u._id);
    await S.audit(db, req, 'account_deleted', { userId: u._id });
    res.json({ ok: true });
  }));

  // ---------- dashboard ----------
  app.get('/api/dashboard', authMw, wrap(async (req, res) => {
    const teacher = req.user.role === 'teacher', uid = req.user.id;
    let classes = [];
    if (teacher) {
      const rawClasses = await db.collection('classrooms').find({ teacher_id: uid }).sort({ _id: -1 }).toArray();
      classes = await Promise.all(rawClasses.map(async (c) => {
        const students = await db.collection('enrollments').countDocuments({ classroom_id: c._id });
        const lectures = await db.collection('sessions').countDocuments({ classroom_id: c._id, ended_at: { $ne: null } });
        const live = await db.collection('sessions').findOne({ classroom_id: c._id, ended_at: null }, { sort: { _id: -1 } });
        return {
          id: c._id,
          name: c.name,
          subject: c.subject,
          language: c.language,
          code: c.code,
          retention_days: c.retention_days,
          students,
          lectures,
          live: live ? live._id : null
        };
      }));
    } else {
      const enrollments = await db.collection('enrollments').find({ user_id: uid }).toArray();
      const cids = enrollments.map(e => e.classroom_id);
      const rawClasses = await db.collection('classrooms').find({ _id: { $in: cids } }).sort({ _id: -1 }).toArray();
      classes = await Promise.all(rawClasses.map(async (c) => {
        const t = await db.collection('users').findOne({ _id: c.teacher_id });
        const lectures = await db.collection('sessions').countDocuments({ classroom_id: c._id, ended_at: { $ne: null } });
        const live = await db.collection('sessions').findOne({ classroom_id: c._id, ended_at: null }, { sort: { _id: -1 } });
        return {
          id: c._id,
          name: c.name,
          subject: c.subject,
          language: c.language,
          teacher_name: t ? t.name : '',
          lectures,
          live: live ? live._id : null
        };
      }));
    }

    const cIds = classes.map(c => c.id);
    const cMap = new Map(classes.map(c => [c.id, c.name]));

    const recentSessions = await db.collection('sessions').find({
      classroom_id: { $in: cIds },
      ended_at: { $ne: null }
    }).sort({ started_at: -1 }).limit(8).toArray();

    const recent = await Promise.all(recentSessions.map(async (s) => {
      const captionsCount = await db.collection('captions').countDocuments({ session_id: s._id });
      const capUsers = await db.collection('captions').distinct('user_id', {
        session_id: s._id,
        user_id: { $ne: null },
        source: { $in: ['sign', 'student'] }
      });
      const reqUsers = await db.collection('requests').distinct('user_id', { session_id: s._id, user_id: { $ne: null } });
      const flagUsers = await db.collection('flags').distinct('user_id', { session_id: s._id, user_id: { $ne: null } });
      const participantSet = new Set([...capUsers, ...reqUsers, ...flagUsers].filter(Boolean));
      const hasAi = await db.collection('ai_summaries').countDocuments({ session_id: s._id });

      return {
        id: s._id,
        title: s.title,
        started_at: s.started_at,
        ended_at: s.ended_at,
        classroom_id: s.classroom_id,
        classroom_name: cMap.get(s.classroom_id) || '',
        captions: captionsCount,
        participants: participantSet.size,
        has_ai: hasAi > 0 ? 1 : 0
      };
    }));

    const out = {
      role: req.user.role,
      classrooms: classes,
      recent,
      live: classes.filter(c => c.live).map(c => ({ classroom_id: c.id, name: c.name, session_id: c.live }))
    };

    if (teacher) {
      const distinctStudents = await db.collection('enrollments').distinct('user_id', { classroom_id: { $in: cIds } });
      out.totals = {
        classrooms: classes.length,
        students: distinctStudents.length,
        lectures: classes.reduce((n, c) => n + c.lectures, 0)
      };
    }

    res.json(out);
  }));

  // ---------- classrooms ----------
  app.get('/api/classrooms', authMw, wrap(async (req, res) => {
    const teacher = req.user.role === 'teacher';
    let classroomDocs = [];
    if (teacher) {
      classroomDocs = await db.collection('classrooms').find({ teacher_id: req.user.id }).sort({ _id: -1 }).toArray();
    } else {
      const enrollments = await db.collection('enrollments').find({ user_id: req.user.id }).toArray();
      const cids = enrollments.map(e => e.classroom_id);
      classroomDocs = await db.collection('classrooms').find({ _id: { $in: cids } }).sort({ _id: -1 }).toArray();
    }

    const rows = await Promise.all(classroomDocs.map(async (c) => {
      const t = await db.collection('users').findOne({ _id: c.teacher_id });
      const teacherName = t ? t.name : '';
      const liveSession = await db.collection('sessions').findOne({ classroom_id: c._id, ended_at: null }, { sort: { _id: -1 } });
      const studentCount = await db.collection('enrollments').countDocuments({ classroom_id: c._id });
      return {
        ...classroomView({ ...c, teacher_name: teacherName }, teacher),
        live: liveSession ? liveSession._id : null,
        students: studentCount
      };
    }));

    res.json(rows);
  }));

  app.post('/api/classrooms', authMw, teacherOnly, wrap(async (req, res) => {
    const name = S.cleanText(req.body?.name, 80), subject = S.cleanText(req.body?.subject, 80), language = req.body?.language || 'en-IN';
    if (name.length < 2) return bad(res, 400, 'Give the classroom a name (at least 2 characters).');
    if (!LANG_CODES.has(language)) return bad(res, 400, 'Choose a supported teaching language.');
    let code, id;
    for (let i = 0; i < 5; i++) {
      code = S.randomCode(8);
      id = await nextId('classrooms', db);
      try {
        await db.collection('classrooms').insertOne({
          _id: id,
          name,
          subject,
          code,
          teacher_id: req.user.id,
          language,
          retention_days: null,
          created_at: now()
        });
        break;
      } catch (err) {
        if (i === 4) throw err;
      }
    }
    if (!id) return bad(res, 500, 'Could not create a unique join code. Try again.');
    await S.audit(db, req, 'classroom_created', { detail: String(id) });
    const created = await db.collection('classrooms').findOne({ _id: id });
    res.status(201).json(classroomView({ ...created, teacher_name: req.user.name }, true));
  }));

  app.post('/api/classrooms/join', authMw, studentOnly, joinLimit, wrap(async (req, res) => {
    const code = String(req.body?.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const c = code.length >= 6 && code.length <= 8 ? await db.collection('classrooms').findOne({ code }) : null;
    if (!c) return bad(res, 404, 'No classroom has that code. Check it with your teacher.');
    await db.collection('enrollments').updateOne(
      { user_id: req.user.id, classroom_id: c._id },
      { $setOnInsert: { joined_at: now() } },
      { upsert: true }
    );
    await S.audit(db, req, 'joined_classroom', { detail: String(c._id) });
    const teacher = await db.collection('users').findOne({ _id: c.teacher_id });
    res.json(classroomView({ ...c, teacher_name: teacher ? teacher.name : '' }, false));
  }));

  app.get('/api/classrooms/:id', authMw, wrap(async (req, res) => {
    const c = await access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    const teacher = req.user.role === 'teacher';
    const live = await db.collection('sessions').findOne({ classroom_id: c._id, ended_at: null }, { sort: { _id: -1 } });
    const rawVocab = await db.collection('vocab').find({ classroom_id: c._id }).sort({ _id: 1 }).toArray();

    let roster = undefined;
    if (teacher) {
      const enrollments = await db.collection('enrollments').find({ classroom_id: c._id }).toArray();
      const uids = enrollments.map(e => e.user_id);
      const users = await db.collection('users').find({ _id: { $in: uids } }).sort({ name: 1 }).toArray();
      const joinMap = new Map(enrollments.map(e => [e.user_id, e.joined_at]));
      roster = users.map(u => ({ id: u._id, name: u.name, email: u.email, joined_at: joinMap.get(u._id) }));
    }

    res.json({
      ...classroomView(c, teacher),
      live: live ? { id: live._id, title: live.title } : null,
      vocab: docs(rawVocab),
      roster
    });
  }));

  app.patch('/api/classrooms/:id', authMw, teacherOnly, wrap(async (req, res) => {
    const c = await access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    const b = req.body || {}, name = b.name !== undefined ? S.cleanText(b.name, 80) : c.name, subject = b.subject !== undefined ? S.cleanText(b.subject, 80) : c.subject;
    const language = b.language ?? c.language, retention = b.retention_days === undefined ? c.retention_days : b.retention_days;
    if (name.length < 2) return bad(res, 400, 'The name must be at least 2 characters.');
    if (!LANG_CODES.has(language)) return bad(res, 400, 'Choose a supported teaching language.');
    if (!retentionOk(retention)) return bad(res, 400, 'Retention must be 0 (keep) or a number of days up to 3650.');
    await db.collection('classrooms').updateOne(
      { _id: c._id },
      { $set: { name, subject, language, retention_days: retention || null } }
    );
    await S.audit(db, req, 'classroom_updated', { detail: String(c._id) });
    const updated = await db.collection('classrooms').findOne({ _id: c._id });
    res.json(classroomView({ ...updated, teacher_name: c.teacher_name }, true));
  }));

  app.post('/api/classrooms/:id/rotate-code', authMw, teacherOnly, wrap(async (req, res) => {
    const c = await access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    let newCode;
    for (let i = 0; i < 5; i++) {
      newCode = S.randomCode(8);
      try {
        await db.collection('classrooms').updateOne({ _id: c._id }, { $set: { code: newCode } });
        break;
      } catch { /* clash */ }
    }
    await S.audit(db, req, 'code_rotated', { detail: String(c._id) });
    res.json({ code: newCode });
  }));

  app.delete('/api/classrooms/:id', authMw, teacherOnly, wrap(async (req, res) => {
    const c = await access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    const live = await db.collection('sessions').findOne({ classroom_id: c._id, ended_at: null });
    if (live) hub.endSession(live._id);
    const sessions = await db.collection('sessions').find({ classroom_id: c._id }).toArray();
    const sessionIds = sessions.map(s => s._id);
    if (sessionIds.length > 0) {
      await db.collection('captions').deleteMany({ session_id: { $in: sessionIds } });
      await db.collection('flags').deleteMany({ session_id: { $in: sessionIds } });
      await db.collection('requests').deleteMany({ session_id: { $in: sessionIds } });
      await db.collection('ai_summaries').deleteMany({ session_id: { $in: sessionIds } });
      await db.collection('sessions').deleteMany({ _id: { $in: sessionIds } });
    }
    await db.collection('enrollments').deleteMany({ classroom_id: c._id });
    await db.collection('vocab').deleteMany({ classroom_id: c._id });
    await db.collection('classrooms').deleteOne({ _id: c._id });
    await S.audit(db, req, 'classroom_deleted', { detail: String(c._id) });
    res.json({ ok: true });
  }));

  app.delete('/api/classrooms/:id/membership', authMw, studentOnly, wrap(async (req, res) => {
    const c = await access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    await db.collection('enrollments').deleteOne({ user_id: req.user.id, classroom_id: c._id });
    hub.disconnectUser(req.user.id);
    res.json({ ok: true });
  }));

  app.delete('/api/classrooms/:id/students/:uid', authMw, teacherOnly, wrap(async (req, res) => {
    const c = await access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    await db.collection('enrollments').deleteOne({ user_id: Number(req.params.uid), classroom_id: c._id });
    res.json({ ok: true });
  }));

  app.post('/api/classrooms/:id/vocab', authMw, teacherOnly, wrap(async (req, res) => {
    const c = await access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    const heard = S.cleanText(req.body?.heard, 60), replacement = S.cleanText(req.body?.replacement, 80);
    if (!heard || !replacement) return bad(res, 400, 'Both fields are required.');
    const count = await db.collection('vocab').countDocuments({ classroom_id: c._id });
    if (count >= 300) return bad(res, 400, 'This classroom already has the maximum of 300 corrections.');
    const existing = await db.collection('vocab').findOne({ classroom_id: c._id, heard });
    if (existing) {
      await db.collection('vocab').updateOne({ _id: existing._id }, { $set: { replacement } });
    } else {
      const vid = await nextId('vocab', db);
      await db.collection('vocab').insertOne({ _id: vid, classroom_id: c._id, heard, replacement });
    }
    const all = await db.collection('vocab').find({ classroom_id: c._id }).sort({ _id: 1 }).toArray();
    res.json(docs(all));
  }));

  app.delete('/api/classrooms/:id/vocab/:vid', authMw, teacherOnly, wrap(async (req, res) => {
    const c = await access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    await db.collection('vocab').deleteOne({ _id: Number(req.params.vid), classroom_id: c._id });
    const all = await db.collection('vocab').find({ classroom_id: c._id }).sort({ _id: 1 }).toArray();
    res.json(docs(all));
  }));

  // ---------- lectures: list, search ----------
  app.get('/api/classrooms/:id/sessions', authMw, wrap(async (req, res) => {
    const c = await access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    const page = intParam(req.query.page, 1, 1, 100000), size = intParam(req.query.pageSize, 10, 1, 50);
    const term = S.cleanText(req.query.q, 80), from = Number(req.query.from) || 0, to = Number(req.query.to) || 0;

    const filter = { classroom_id: c._id };
    if (from) filter.started_at = { ...(filter.started_at || {}), $gte: from };
    if (to) filter.started_at = { ...(filter.started_at || {}), $lte: to };

    if (term) {
      const allClassSessions = await db.collection('sessions').find({ classroom_id: c._id }, { projection: { _id: 1 } }).toArray();
      const allSids = allClassSessions.map(s => s._id);
      let capSessionIds = [];
      if (allSids.length) {
        capSessionIds = await db.collection('captions').distinct('session_id', {
          $text: { $search: term },
          session_id: { $in: allSids }
        });
      }
      const titleRegex = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { title: titleRegex },
        { _id: { $in: capSessionIds } }
      ];
    }

    const total = await db.collection('sessions').countDocuments(filter);
    const sessionDocs = await db.collection('sessions').find(filter).sort({ started_at: -1 }).skip((page - 1) * size).limit(size).toArray();

    const items = await Promise.all(sessionDocs.map(async (s) => ({
      id: s._id,
      title: s.title,
      started_at: s.started_at,
      ended_at: s.ended_at,
      captions: await db.collection('captions').countDocuments({ session_id: s._id }),
      has_ai: (await db.collection('ai_summaries').countDocuments({ session_id: s._id })) > 0
    })));

    res.json({ items, total, page, pageSize: size, pages: Math.max(1, Math.ceil(total / size)) });
  }));

  app.get('/api/classrooms/:id/search', authMw, wrap(async (req, res) => {
    const c = await access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    const term = S.cleanText(req.query.q, 80);
    if (!term) return res.json({ items: [], total: 0, page: 1, pageSize: 20 });
    const page = intParam(req.query.page, 1, 1, 1000), size = intParam(req.query.pageSize, 20, 1, 50);

    const sList = await db.collection('sessions').find({ classroom_id: c._id }).toArray();
    if (!sList.length) return res.json({ items: [], total: 0, page: 1, pageSize: size });
    const sMap = new Map(sList.map(s => [s._id, s.title]));
    const sIds = Array.from(sMap.keys());

    const query = { session_id: { $in: sIds }, $text: { $search: term } };
    const total = await db.collection('captions').countDocuments(query);
    const caps = await db.collection('captions').find(query).sort({ _id: -1 }).skip((page - 1) * size).limit(size).toArray();
    const items = caps.map(cp => ({
      id: cp._id,
      session_id: cp.session_id,
      text: cp.text,
      speaker: cp.speaker,
      t_ms: cp.t_ms,
      title: sMap.get(cp.session_id) || ''
    }));

    res.json({ items, total, page, pageSize: size });
  }));

  // ---------- sessions ----------
  app.post('/api/classrooms/:id/sessions', authMw, teacherOnly, wrap(async (req, res) => {
    const c = await access(req.user, idParam(req)); if (!c) return bad(res, 404, 'Classroom not found.');
    let s = await db.collection('sessions').findOne({ classroom_id: c._id, ended_at: null }, { sort: { _id: -1 } });
    if (!s) {
      const title = S.cleanText(req.body?.title, 100) || `${c.name} – ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;
      const id = await nextId('sessions', db);
      const sessionDoc = {
        _id: id,
        classroom_id: c._id,
        title,
        started_at: now(),
        ended_at: null
      };
      await db.collection('sessions').insertOne(sessionDoc);
      s = sessionDoc;
      await S.audit(db, req, 'session_started', { detail: String(s._id) });
    }
    res.json(doc(s));
  }));

  app.post('/api/sessions/:id/end', authMw, teacherOnly, wrap(async (req, res) => {
    const { s, c } = await sessionAccess(req.user, idParam(req)); if (!s || !c) return bad(res, 404, 'Lesson not found.');
    if (!s.ended_at) {
      const endedAt = now();
      await db.collection('sessions').updateOne({ _id: s.id }, { $set: { ended_at: endedAt } });
      s.ended_at = endedAt;
      await S.audit(db, req, 'session_ended', { detail: String(s.id) });
    }
    hub.endSession(s.id);
    const updated = await db.collection('sessions').findOne({ _id: s.id });
    res.json(doc(updated));
  }));

  app.delete('/api/sessions/:id', authMw, teacherOnly, wrap(async (req, res) => {
    const { s, c } = await sessionAccess(req.user, idParam(req)); if (!s || !c) return bad(res, 404, 'Lesson not found.');
    if (!s.ended_at) hub.endSession(s.id);
    await db.collection('captions').deleteMany({ session_id: s.id });
    await db.collection('flags').deleteMany({ session_id: s.id });
    await db.collection('requests').deleteMany({ session_id: s.id });
    await db.collection('ai_summaries').deleteMany({ session_id: s.id });
    await db.collection('sessions').deleteOne({ _id: s.id });
    await S.audit(db, req, 'session_deleted', { detail: String(s.id) });
    res.json({ ok: true });
  }));

  app.post('/api/sessions/:id/ws-ticket', authMw, wrap(async (req, res) => {
    const { s, c } = await sessionAccess(req.user, idParam(req)); if (!s || !c) return bad(res, 404, 'Lesson not found.');
    if (s.ended_at) return bad(res, 410, 'This lesson has ended.', { code: 'ended' });
    res.json({ ticket: hub.issueTicket(req.user, s.id), expiresInSec: 30 });
  }));

  app.get('/api/sessions/:id', authMw, wrap(async (req, res) => {
    const { s, c } = await sessionAccess(req.user, idParam(req)); if (!s || !c) return bad(res, 404, 'Lesson not found.');
    const rawCaps = await db.collection('captions').find({ session_id: s.id }).sort({ _id: 1 }).toArray();
    const caps = docs(rawCaps);
    const cached = await db.collection('ai_summaries').findOne({ session_id: s.id });

    const reqList = await db.collection('requests').aggregate([
      { $match: { session_id: s.id } },
      { $group: { _id: '$kind', n: { $sum: 1 } } }
    ]).toArray();
    const requests = Object.fromEntries(reqList.map(r => [r._id, r.n]));

    const confusingFlags = await db.collection('flags').aggregate([
      { $match: { session_id: s.id, kind: 'confusing' } },
      { $group: { _id: '$caption_id', n: { $sum: 1 } } },
      { $sort: { n: -1, _id: 1 } },
      { $limit: 5 }
    ]).toArray();
    const capIds = confusingFlags.map(f => f._id);
    const flagCaps = await db.collection('captions').find({ _id: { $in: capIds } }).toArray();
    const flagCapMap = new Map(flagCaps.map(cp => [cp._id, cp]));
    const confusing = confusingFlags.map(f => {
      const cp = flagCapMap.get(f._id);
      return { id: f._id, text: cp?.text || '', t_ms: cp?.t_ms || 0, n: f.n };
    });

    res.json({
      session: s,
      classroom: { id: c._id ?? c.id, name: c.name, language: c.language },
      requests,
      summary: T.summarize(caps),
      confusing,
      captionCount: caps.length,
      ai: { available: summarizer.enabled, cached: cached ? { ...JSON.parse(cached.content), generatedAt: cached.created_at, model: cached.model } : null }
    });
  }));

  app.get('/api/sessions/:id/captions', authMw, wrap(async (req, res) => {
    const { s, c } = await sessionAccess(req.user, idParam(req)); if (!s || !c) return bad(res, 404, 'Lesson not found.');
    const limit = intParam(req.query.limit, 200, 1, 500), after = intParam(req.query.after, 0, 0, Number.MAX_SAFE_INTEGER);
    const term = req.query.q ? S.cleanText(req.query.q, 80) : '';

    const filter = { session_id: s.id, _id: { $gt: after } };
    if (term) {
      filter.$text = { $search: term };
    }

    const rawItems = await db.collection('captions').find(filter).sort({ _id: 1 }).limit(limit).toArray();
    const items = rawItems.map(cp => ({ id: cp._id, source: cp.source, speaker: cp.speaker, text: cp.text, t_ms: cp.t_ms }));

    const flagRows = await db.collection('flags').aggregate([
      { $match: { session_id: s.id } },
      { $group: { _id: { caption_id: '$caption_id', kind: '$kind' }, n: { $sum: 1 } } }
    ]).toArray();
    const flags = {};
    for (const f of flagRows) {
      (flags[f._id.caption_id] ||= {})[f._id.kind] = f.n;
    }

    res.json({ items, flags, nextAfter: items.length === limit ? items[items.length - 1].id : null });
  }));

  app.get('/api/sessions/:id/export', authMw, wrap(async (req, res) => {
    const { s, c } = await sessionAccess(req.user, idParam(req)); if (!s || !c) return bad(res, 404, 'Lesson not found.');
    const rawCaps = await db.collection('captions').find({ session_id: s.id }).sort({ _id: 1 }).toArray();
    const caps = docs(rawCaps);
    const fmt = String(req.query.format || 'txt');
    const base = S.safeFilename(s.title);
    const out = {
      srt: ['application/x-subrip', () => T.toSRT(caps)],
      vtt: ['text/vtt', () => T.toVTT(caps)],
      json: ['application/json', () => JSON.stringify({ session: s, captions: caps, summary: T.summarize(caps) }, null, 2)],
      txt: ['text/plain', () => T.toTXT(caps, s.title)]
    }[fmt];
    if (!out) return bad(res, 400, 'Format must be txt, srt, vtt or json.');
    res.type(out[0]).set('Content-Disposition', `attachment; filename="${base}.${fmt}"`).send(out[1]());
  }));

  // ---------- optional AI summary ----------
  const aiErr = (res, e) => {
    if (e instanceof AiError) return bad(res, e.status, e.message, { code: e.code, fallback: 'The automatic (extractive) summary is still available.' });
    log.error('ai failure', { err: e.message }); return bad(res, 500, 'The AI summary could not be generated.');
  };

  app.get('/api/sessions/:id/ai-summary', authMw, wrap(async (req, res) => {
    const { s, c } = await sessionAccess(req.user, idParam(req)); if (!s || !c) return bad(res, 404, 'Lesson not found.');
    const row = await db.collection('ai_summaries').findOne({ session_id: s.id });
    res.json({
      available: summarizer.enabled,
      cached: row ? { ...JSON.parse(row.content), generatedAt: row.created_at, model: row.model } : null,
      label: 'AI-generated from the lecture transcript. It may contain mistakes – check it against the transcript.'
    });
  }));

  app.post('/api/sessions/:id/ai-summary', authMw, teacherOnly, aiLimit, wrap(async (req, res) => {
    const { s, c } = await sessionAccess(req.user, idParam(req)); if (!s || !c) return bad(res, 404, 'Lesson not found.');
    if (!summarizer.enabled) return bad(res, 501, 'AI summaries are not configured on this server. The automatic summary is still available.', { code: 'not_configured' });
    if (!s.ended_at) return bad(res, 409, 'End the lesson before generating a summary.');
    if (req.body?.confirmExternal !== true) return bad(res, 400, 'Confirm that the lecture transcript may be sent to the configured AI provider.', { code: 'consent_required' });
    const caps = docs(await db.collection('captions').find({ session_id: s.id }).sort({ _id: 1 }).toArray());
    const { text, truncated, lines } = T.transcriptForAi(caps, cfg.ai.maxInputChars);
    const hash = summarizer.hash(text);
    const cached = await db.collection('ai_summaries').findOne({ session_id: s.id });
    if (cached && cached.input_hash === hash && !req.body?.force) {
      return res.json({ cached: true, truncated, ...JSON.parse(cached.content), generatedAt: cached.created_at, model: cached.model });
    }
    if (cached && now() - cached.created_at < 60_000) return bad(res, 429, 'A summary was just generated. Wait a minute before regenerating.');
    if (lines === 0) return bad(res, 422, 'There are no teacher captions to summarise.', { code: 'too_short' });

    const day = new Date().toISOString().slice(0, 10);
    await db.collection('ai_usage').updateOne({ day }, { $setOnInsert: { calls: 0 } }, { upsert: true });
    const usage = await db.collection('ai_usage').findOneAndUpdate(
      { day, calls: { $lt: cfg.ai.dailyLimit } },
      { $inc: { calls: 1 } },
      { returnDocument: 'after' }
    );
    if (!usage) return bad(res, 429, 'The daily AI summary limit for this server has been reached. Try again tomorrow.', { code: 'daily_limit' });

    const t0 = now();
    try {
      const result = await summarizer.summarize(text, { title: s.title });
      await db.collection('ai_summaries').updateOne(
        { session_id: s.id },
        {
          $set: {
            session_id: s.id,
            content: JSON.stringify(result),
            input_hash: hash,
            provider: summarizer.provider,
            model: summarizer.model,
            created_at: now(),
            created_by: req.user.id
          }
        },
        { upsert: true }
      );
      await S.audit(db, req, 'ai_summary', { detail: `session ${s.id}` });
      log.info('ai summary', { session: s.id, ms: now() - t0, truncated });
      res.json({ cached: false, truncated, ...result, generatedAt: now(), model: summarizer.model });
    } catch (e) {
      log.warn('ai summary failed', { session: s.id, code: e.code, ms: now() - t0 });
      aiErr(res, e);
    }
  }));

  // ---------- optional server-side transcription ----------
  const audioTypes = ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/mp4'];
  app.post('/api/sessions/:id/transcribe', authMw, teacherOnly, trLimit, express.raw({ type: audioTypes, limit: cfg.transcription.maxBytes + 1024 }), wrap(async (req, res) => {
    const { s, c } = await sessionAccess(req.user, idParam(req)); if (!s || !c) return bad(res, 404, 'Lesson not found.');
    if (!transcriber.enabled) return bad(res, 501, 'Server-side transcription is not configured. Browser speech recognition and typed captions still work.', { code: 'not_configured' });
    if (s.ended_at) return bad(res, 410, 'This lesson has ended.');
    if (String(req.headers['x-audio-consent'] || '').toLowerCase() !== 'yes') return bad(res, 400, 'Audio consent is required: send header X-Audio-Consent: yes after the teacher agrees to upload audio to the transcription provider.', { code: 'consent_required' });
    if (!Buffer.isBuffer(req.body)) return bad(res, 415, 'Send the audio as the raw request body with an audio/* Content-Type.');
    const declared = req.headers['x-audio-duration-ms'] != null ? Number(req.headers['x-audio-duration-ms']) : null;
    try {
      const raw = await transcriber.transcribe(req.body, req.headers['content-type'], { language: c.language, declaredMs: declared });
      const vocab = await db.collection('vocab').find({ classroom_id: c._id ?? c.id }).toArray();
      const text = T.applyVocab(raw.text, vocab);
      if (!text) return res.json({ text: '', published: false });
      let published = false;
      if (req.query.broadcast === '1') {
        await hub.publishCaption(s, c._id ?? c.id, { source: 'speech', speaker: req.user.name, text, userId: req.user.id });
        published = true;
      }
      res.json({ text, published });
    } catch (e) {
      if (e instanceof TranscribeError) return bad(res, e.status, e.message, { code: e.code });
      throw e;
    }
  }));

  if (mount) mount(app, { auth: authMw, wrap });

  // ---------- static app (built React classroom app) ----------
  let mediapipeDir = null;
  try { mediapipeDir = path.dirname(require.resolve('@mediapipe/tasks-vision/package.json')); } catch { try { mediapipeDir = path.dirname(require.resolve('@mediapipe/tasks-vision')); } catch { /* not installed */ } }
  if (mediapipeDir) app.use('/vendor/mediapipe', express.static(mediapipeDir, { maxAge: '7d', index: false }));
  const indexFile = path.join(cfg.staticDir, 'index.html');
  const hasFrontend = fs.existsSync(indexFile);
  if (hasFrontend) {
    app.use(express.static(cfg.staticDir, { index: false, setHeaders: (res, p) => { res.set('Cache-Control', /[\\/]assets[\\/]/.test(p) ? 'public, max-age=31536000, immutable' : 'no-cache'); } }));
  }
  app.use('/api', (req, res) => bad(res, 404, 'Not found.'));
  app.get(/^\/(?!api\/|ws(\/|$)|health$|vendor\/).*/, (req, res, next) => {
    if (/\.[a-z0-9]{1,8}$/i.test(req.path)) return next();
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
  const purgeTimer = setInterval(async () => {
    try { await purgeExpired(db, cfg.defaultRetentionDays); }
    catch (e) { log.error('purge failed', { err: e.message }); }
  }, 6 * 3600_000);
  purgeTimer.unref();

  server.requestTimeout = 60_000; server.headersTimeout = 20_000; server.keepAliveTimeout = 65_000;
  let closed = false;
  const close = () => new Promise((resolve) => {
    if (closed) return resolve(); closed = true;
    clearInterval(purgeTimer); [apiLimit, registerLimit, loginLimit, joinLimit, aiLimit, trLimit].forEach(l => l.stop());
    try { speechEngine.close(); } catch { /* ignore */ }
    hub.close();
    const done = async () => {
      try { if (!injectedDb) await closeDb(); } catch { /* already closed */ }
      resolve();
    };
    if (!server.listening) return done();
    server.close(done); server.closeIdleConnections?.(); setTimeout(() => { server.closeAllConnections?.(); }, 2000).unref();
  });
  return { app, server, db, hub, speechEngine, close, config: cfg, purge: () => purgeExpired(db, cfg.defaultRetentionDays) };
}

module.exports = { createApp };
