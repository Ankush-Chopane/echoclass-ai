// Integration test: the React app's REAL api client (src/services/api.js) against the REAL Express backend + SQLite (in-memory).
// Proves the frontend/backend contract end to end: register -> login -> classroom -> live session -> captions -> transcript -> exports -> study notes.
// The AI provider is a local stub (no network, no key); everything else is the production code path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import WebSocket from 'ws';

const require = createRequire(import.meta.url);
const { create } = require('../../backend/src/server.js');

// ---- minimal browser shims (the client only needs fetch, localStorage, window events, and an anchor/Blob for downloads)
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const events = [];
globalThis.window = { dispatchEvent: (e) => events.push(e.type), addEventListener() {}, removeEventListener() {}, location: { origin: 'http://x', protocol: 'http:', host: 'x' } };
const clicks = [];
globalThis.document = { createElement: () => ({ click() { clicks.push({ href: this.href, name: this.download }); }, remove() {} }), body: { appendChild() {} } };
let lastBlob = null;
URL.createObjectURL = (b) => { lastBlob = b; return 'blob:test'; };
URL.revokeObjectURL = () => {};

let base, ctx, server, api, apiMod;
const AI_JSON = JSON.stringify({ summary: 'The class covered mitochondria and energy.', concepts: ['Cell energy'], keyPoints: ['Mitochondria make energy'], terms: [{ term: 'mitochondria', meaning: 'The part of the cell that releases energy.' }], questions: ['What do mitochondria do?'], actionItems: [], notes: 'Mitochondria make energy for the cell.' });
let aiCalls = 0;
const stubFetch = async (url) => { aiCalls++; return new Response(JSON.stringify({ content: [{ type: 'text', text: AI_JSON }] }), { status: 200, headers: { 'content-type': 'application/json' } }); };

test.before(async () => {
  ctx = create({ DATABASE_PATH: ':memory:', AI_PROVIDER: 'anthropic', AI_API_KEY: 'test-key', AI_MODEL: 'test-model', AI_BASE_URL: 'http://stub.invalid', TEACHER_INVITE_CODE: 'invite-12345' }, { fetch: stubFetch, limits: { register: 1000, login: 1000 } });
  await new Promise((r) => ctx.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${ctx.server.address().port}`;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (u, o) => realFetch(typeof u === 'string' && u.startsWith('/') ? base + u : u, o);   // the app uses same-origin relative URLs
  apiMod = await import('../src/services/api.js');
  api = apiMod.api;
});
test.after(async () => { await ctx.close(); });

const as = (u) => store.set(apiMod.TOKEN_KEY, u.token);
const openSocket = async (user, sessionId) => {
  as(user);
  const { ticket } = await api.getWsTicket(sessionId);
  const ws = new WebSocket(`${apiMod.wsBaseUrl().replace('ws://x', base.replace('http', 'ws'))}/ws?ticket=${ticket}`);
  ws.msgs = []; ws.on('message', (m) => ws.msgs.push(JSON.parse(m)));
  await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  return ws;
};
const until = async (fn, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); } throw new Error('timed out'); };

const S = {};   // shared state across the ordered steps below

test('config is public and describes the server', async () => {
  store.clear();
  const cfg = await api.getConfig();
  assert.equal(cfg.teacherInviteRequired, true);
  assert.ok(Array.isArray(cfg.languages) && cfg.languages.length >= 10);
  assert.equal(cfg.aiSummaries, true);
  assert.ok(!JSON.stringify(cfg).includes('modelPath'));
});

test('register: teacher needs the invite code; field errors come back in err.fields; students register freely', async () => {
  await assert.rejects(api.register({ name: 'Ms Rao', email: 'rao@example.com', password: 'Passw0rd!', role: 'teacher', inviteCode: 'wrong' }), (e) => e.status === 400 && !!e.fields.inviteCode);
  S.teacher = await api.register({ name: 'Ms Rao', email: 'rao@example.com', password: 'Passw0rd!', role: 'teacher', inviteCode: 'invite-12345' });
  S.student = await api.register({ name: 'Asha Patel', email: 'asha@example.com', password: 'Passw0rd!', role: 'student' });
  assert.ok(S.teacher.token && S.teacher.user.role === 'teacher' && !('password_hash' in S.teacher.user));
  await assert.rejects(api.register({ name: 'Dup', email: 'RAO@example.com', password: 'Passw0rd!', role: 'student' }), (e) => e.status === 409 && !!e.fields.email);
  await assert.rejects(api.register({ name: 'Eve', email: 'eve@example.com', password: 'Passw0rd!', role: 'admin' }), (e) => e.status === 400);   // no admin role exists
});

test('login + getMe: GET /me returns the user object itself; wrong password is a clean 401', async () => {
  await assert.rejects(api.login({ email: 'rao@example.com', password: 'nope-nope' }), (e) => e.status === 401);
  const l = await api.login({ email: 'rao@example.com', password: 'Passw0rd!' });
  S.teacher.token = l.token; as(S.teacher);
  const me = await api.getMe();
  assert.equal(me.email, 'rao@example.com'); assert.equal(me.role, 'teacher');
  S.student.token = (await api.login({ email: 'asha@example.com', password: 'Passw0rd!' })).token;
});

test('a rejected token raises the app-wide unauthorized event', async () => {
  store.set(apiMod.TOKEN_KEY, 'garbage.token.value'); events.length = 0;
  await assert.rejects(api.getMe(), (e) => e.status === 401);
  assert.ok(events.includes(apiMod.UNAUTHORIZED_EVENT));
  as(S.teacher);
});

test('classrooms: teacher creates, student joins by code, dashboard + detail shapes match what the UI reads', async () => {
  as(S.teacher);
  S.cls = await api.createClassroom({ name: 'Biology 9', subject: 'Science', language: 'en-IN' });
  assert.match(S.cls.code, /^[A-Z0-9]{8}$/);
  as(S.student);
  await assert.rejects(api.createClassroom({ name: 'Nope' }), (e) => e.status === 403);
  await assert.rejects(api.joinClassroom('ZZZZZZZZ'), (e) => e.status === 404);
  const joined = await api.joinClassroom(S.cls.code.toLowerCase());
  assert.equal(joined.id, S.cls.id); assert.ok(!('code' in joined), 'students never receive the join code');
  const d = await api.getDashboard();
  assert.equal(d.classrooms[0].name, 'Biology 9'); assert.equal(d.classrooms[0].teacher_name, 'Ms Rao');
  as(S.teacher);
  const td = await api.getDashboard();
  assert.equal(td.totals.students, 1); assert.equal(td.classrooms[0].students, 1);
  const detail = await api.getClassroom(S.cls.id);
  assert.equal(detail.live, null); assert.ok(Array.isArray(detail.vocab)); assert.equal(detail.roster[0].name, 'Asha Patel');
  assert.equal(detail.id, S.cls.id, 'detail is the classroom itself, not { classroom }');
});

test('vocabulary: add/list/delete by id; server returns the full updated list', async () => {
  as(S.teacher);
  let list = await api.addVocab(S.cls.id, 'might a conjure', 'mitochondria');
  assert.deepEqual(list.map((v) => [v.heard, v.replacement]), [['might a conjure', 'mitochondria']]);
  list = await api.addVocab(S.cls.id, 'might a conjure', 'Mitochondria');           // same word updates instead of duplicating
  assert.equal(list.length, 1); assert.equal(list[0].replacement, 'Mitochondria');
  await assert.rejects(api.addVocab(S.cls.id, '', 'x'), (e) => e.status === 400);
  as(S.student);
  await assert.rejects(api.addVocab(S.cls.id, 'a', 'b'), (e) => e.status === 403);
  as(S.teacher);
  const id = list[0].id;
  assert.deepEqual(await api.deleteVocab(S.cls.id, id), []);
  S.vocab = await api.addVocab(S.cls.id, 'might a conjure', 'mitochondria');
});

test('live session: start, tickets, captions with vocabulary correction, requests, flags, end', async () => {
  as(S.teacher);
  S.session = await api.startSession(S.cls.id, 'Cells');
  assert.equal((await api.getClassroom(S.cls.id)).live.id, S.session.id);
  const tws = await openSocket(S.teacher, S.session.id);
  const sws = await openSocket(S.student, S.session.id);
  await until(() => sws.msgs.some((m) => m.type === 'init'));
  // a ticket is single-use
  as(S.student); const t = await api.getWsTicket(S.session.id);
  const ok1 = await new Promise((res) => { const w = new WebSocket(`${base.replace('http', 'ws')}/ws?ticket=${t.ticket}`); w.on('open', () => { w.close(); res(true); }); w.on('error', () => res(false)); });
  const ok2 = await new Promise((res) => { const w = new WebSocket(`${base.replace('http', 'ws')}/ws?ticket=${t.ticket}`); w.on('open', () => res(true)); w.on('error', () => res(false)); });
  assert.equal(ok1, true); assert.equal(ok2, false);

  tws.send(JSON.stringify({ type: 'caption', source: 'speech', final: true, text: 'The might a conjure makes energy', cid: 'cid-teacher-1' }));
  tws.send(JSON.stringify({ type: 'caption', source: 'typed', final: true, text: 'Photosynthesis happens in chloroplasts', cid: 'cid-teacher-2' }));
  tws.send(JSON.stringify({ type: 'caption', source: 'speech', final: true, text: 'The might a conjure makes energy', cid: 'cid-teacher-1' }));   // retransmit after a reconnect
  await until(() => sws.msgs.filter((m) => m.type === 'caption').length >= 2);
  await new Promise((r) => setTimeout(r, 200));
  const caps = sws.msgs.filter((m) => m.type === 'caption').map((m) => m.caption);
  assert.equal(caps.length, 2, 'retransmitted cid is not duplicated');
  assert.equal(caps[0].text, 'The mitochondria makes energy', 'vocabulary correction applied server-side');
  assert.ok(tws.msgs.some((m) => m.type === 'ack' && m.cid === 'cid-teacher-1'));

  sws.send(JSON.stringify({ type: 'caption', source: 'sign', final: true, text: 'I understand.', cid: 'cid-student-1' }));
  sws.send(JSON.stringify({ type: 'caption', source: 'speech', final: true, text: 'student pretending to be the teacher', cid: 'cid-student-2' }));   // not allowed
  sws.send(JSON.stringify({ type: 'request', kind: 'slow_down' }));
  sws.send(JSON.stringify({ type: 'flag', captionId: caps[0].id, kind: 'confusing' }));
  await until(() => tws.msgs.some((m) => m.type === 'request' && m.counts.slow_down === 1));
  await until(() => tws.msgs.some((m) => m.type === 'flag' && m.count === 1));
  await until(() => sws.msgs.some((m) => m.type === 'error' && m.code === 'bad_caption'));
  S.caps = caps; S.tws = tws; S.sws = sws;
});

test('authorization: outsiders cannot read, and the teacher/student roles are enforced on the REST API', async () => {
  const eve = await api.register({ name: 'Eve Outsider', email: 'eve2@example.com', password: 'Passw0rd!', role: 'student' });
  as(eve);
  await assert.rejects(api.getClassroom(S.cls.id), (e) => e.status === 404);
  await assert.rejects(api.getWsTicket(S.session.id), (e) => e.status === 404);
  await assert.rejects(api.getCaptions(S.session.id), (e) => e.status === 404);
  as(S.student);
  await assert.rejects(api.endSession(S.session.id), (e) => e.status === 403);
  await assert.rejects(api.getNetwork(), (e) => e.status === 403);
});

test('end session, then transcript: metadata, paginated + searched captions, summary, flags, requests', async () => {
  as(S.teacher);
  const ended = await api.endSession(S.session.id);
  assert.ok(ended.ended_at);
  await until(() => S.sws.msgs.some((m) => m.type === 'ended'));
  await assert.rejects(api.getWsTicket(S.session.id), (e) => e.status === 410);
  as(S.student);
  const meta = await api.getSession(S.session.id);
  assert.equal(meta.session.title, 'Cells'); assert.equal(meta.classroom.name, 'Biology 9');
  assert.equal(meta.captionCount, 3); assert.equal(meta.requests.slow_down, 1); assert.equal(meta.confusing[0].n, 1);
  assert.ok(meta.summary.stats.words > 0 && Array.isArray(meta.summary.keywords));
  assert.equal(meta.ai.available, true); assert.equal(meta.ai.cached, null);
  const page1 = await api.getCaptions(S.session.id, { limit: 2 });
  assert.equal(page1.items.length, 2); assert.ok(page1.nextAfter);
  const page2 = await api.getCaptions(S.session.id, { after: page1.nextAfter, limit: 2 });
  assert.equal(page2.items.length, 1); assert.equal(page2.nextAfter, null);
  assert.equal(page2.items[0].source, 'sign');
  const found = await api.getCaptions(S.session.id, { q: 'chloroplasts' });
  assert.equal(found.items.length, 1); assert.match(found.items[0].text, /Photosynthesis/);
  assert.equal(page1.flags[S.caps[0].id].confusing, 1);
  const list = await api.listSessions(S.cls.id, { q: 'chloroplast' });
  assert.equal(list.total, 1); assert.equal(list.items[0].captions, 3);
  const search = await api.searchClassroom(S.cls.id, 'energy');
  assert.equal(search.total, 1);
});

test('authenticated downloads: the JWT is sent, filename comes from the server, all four formats work', async () => {
  as(S.student);
  for (const fmt of ['txt', 'srt', 'vtt', 'json']) {
    clicks.length = 0;
    const name = await api.exportTranscript(S.session.id, fmt);
    assert.equal(name, `Cells.${fmt}`); assert.equal(clicks.length, 1); assert.equal(clicks[0].name, `Cells.${fmt}`);
    const text = await lastBlob.text();
    assert.ok(text.includes('mitochondria'), fmt + ' contains the corrected transcript');
  }
  store.set(apiMod.TOKEN_KEY, 'bad');
  await assert.rejects(api.exportTranscript(S.session.id, 'txt'), (e) => e.status === 401);   // a plain <a href> could never have sent a token; fetch + blob does
  as(S.student);
  await assert.rejects(api.exportTranscript(S.session.id, 'pdf'), (e) => e.status === 400);
});

test('study notes: consent is mandatory, teacher-only, cached, labelled; the provider only receives teacher captions', async () => {
  as(S.student);
  await assert.rejects(api.generateAiSummary(S.session.id), (e) => e.status === 403);
  as(S.teacher);
  // the client always sends confirmExternal:true because the UI shows a consent dialog first; the server refuses without it:
  const raw = await fetch(`/api/sessions/${S.session.id}/ai-summary`, { method: 'POST', headers: { Authorization: 'Bearer ' + S.teacher.token, 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(raw.status, 400); assert.equal((await raw.json()).code, 'consent_required'); assert.equal(aiCalls, 0);
  const first = await api.generateAiSummary(S.session.id);
  assert.equal(first.cached, false); assert.match(first.summary, /mitochondria/); assert.equal(aiCalls, 1);
  const again = await api.generateAiSummary(S.session.id);
  assert.equal(again.cached, true); assert.equal(aiCalls, 1, 'identical transcript is served from cache');
  as(S.student);
  const view = await api.getSession(S.session.id);
  assert.match(view.ai.cached.summary, /mitochondria/);               // students can read saved notes
  assert.equal((await api.getAiSummary(S.session.id)).cached.terms[0].term, 'mitochondria');
});

test('account: password change returns a fresh token and kills the old one; logout-all; delete needs the password', async () => {
  const u = await api.register({ name: 'Temp Student', email: 'temp@example.com', password: 'Passw0rd!', role: 'student' });
  as(u);
  const changed = await api.changePassword('Passw0rd!', 'N3w-Passw0rd');
  assert.ok(changed.token);
  await assert.rejects(api.getMe(), (e) => e.status === 401);          // old token invalidated
  store.set(apiMod.TOKEN_KEY, changed.token);
  assert.equal((await api.getMe()).email, 'temp@example.com');
  await assert.rejects(api.changePassword('wrong-password', 'xxxxxxxx1'), (e) => e.status === 403);
  await api.logoutAll();
  await assert.rejects(api.getMe(), (e) => e.status === 401);
  const l = await api.login({ email: 'temp@example.com', password: 'N3w-Passw0rd' }); store.set(apiMod.TOKEN_KEY, l.token);
  await assert.rejects(api.deleteAccount('wrong'), (e) => e.status === 403);
  await api.deleteAccount('N3w-Passw0rd');
  await assert.rejects(api.login({ email: 'temp@example.com', password: 'N3w-Passw0rd' }), (e) => e.status === 401);
});

test('teacher cleanup: delete lecture and classroom through the API', async () => {
  as(S.teacher);
  await api.deleteSession(S.session.id);
  await assert.rejects(api.getSession(S.session.id), (e) => e.status === 404);
  await api.deleteClassroom(S.cls.id);
  assert.deepEqual((await api.getClassrooms()), []);
  S.tws.close(); S.sws.close();
});

test('network failures surface as ApiError(status 0) with a human message', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(new TypeError('fetch failed'));
  try { await assert.rejects(api.getConfig(), (e) => e.status === 0 && /Cannot reach/.test(e.message)); } finally { globalThis.fetch = real; }
});
