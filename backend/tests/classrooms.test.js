const test = require('node:test'), assert = require('node:assert');
const { start, wait, send, waitFor } = require('./helpers');
const { purgeExpired } = require('../src/retention');

let h, T, S, cls, sess, outsider, otherTeacher;
test.before(async () => {
  h = await start();
  T = await h.user('teacher', 'Ms Rao'); S = await h.user('student', 'Aarav'); outsider = await h.user('student', 'Eve'); otherTeacher = await h.user('teacher', 'Mr Other');
  cls = await h.classroom(T); await h.join(S, cls);
});
test.after(() => h.close());
const get = (p, u) => h.api(p, { token: u.token });

test('classroom creation validates input; join code is strong; students cannot see it', async () => {
  assert.match(cls.code, /^[A-HJ-NP-Z2-9]{8}$/);
  assert.equal((await h.api('/api/classrooms', { method: 'POST', token: T.token, body: { name: 'x' } })).status, 400);
  assert.equal((await h.api('/api/classrooms', { method: 'POST', token: T.token, body: { name: 'Fine', language: 'xx-ZZ' } })).status, 400);
  assert.equal((await get(`/api/classrooms/${cls.id}`, S)).body.code, undefined);
  assert.equal((await get('/api/classrooms', S)).body[0].code, undefined);
});

test('joining: valid, case-insensitive, invalid code, teachers cannot join, rate limited, rotation invalidates old code', async () => {
  assert.equal((await h.api('/api/classrooms/join', { method: 'POST', token: outsider.token, body: { code: cls.code.toLowerCase() } })).status, 200);
  assert.equal((await h.api('/api/classrooms/join', { method: 'POST', token: outsider.token, body: { code: 'ZZZZZZZZ' } })).status, 404);
  assert.equal((await h.api('/api/classrooms/join', { method: 'POST', token: T.token, body: { code: cls.code } })).status, 403);
  const old = cls.code;
  const rot = await h.api(`/api/classrooms/${cls.id}/rotate-code`, { method: 'POST', token: T.token }); assert.notEqual(rot.body.code, old); cls.code = rot.body.code;
  const newcomer = await h.user('student');
  assert.equal((await h.api('/api/classrooms/join', { method: 'POST', token: newcomer.token, body: { code: old } })).status, 404);
  assert.equal((await h.api('/api/classrooms/join', { method: 'POST', token: S.token, body: { code: 'x' } })).status, 404);
  let last; for (let i = 0; i < 12; i++) last = await h.api('/api/classrooms/join', { method: 'POST', token: newcomer.token, body: { code: 'AAAAAAAA' } });
  assert.equal(last.status, 429);
  await h.api(`/api/classrooms/${cls.id}/membership`, { method: 'DELETE', token: outsider.token });
  assert.equal((await get(`/api/classrooms/${cls.id}`, outsider)).status, 404);     // left → no access any more
});

test('teacher-only operations are enforced on the backend', async () => {
  sess = await h.live(T, cls, 'Cells & Energy');
  for (const [m, p, b] of [['POST', `/api/classrooms/${cls.id}/sessions`, {}], ['POST', `/api/sessions/${sess.id}/end`], ['DELETE', `/api/sessions/${sess.id}`], ['PATCH', `/api/classrooms/${cls.id}`, { name: 'Hacked' }], ['DELETE', `/api/classrooms/${cls.id}`], ['POST', `/api/classrooms/${cls.id}/vocab`, { heard: 'a', replacement: 'b' }], ['POST', `/api/classrooms/${cls.id}/rotate-code`]])
    assert.equal((await h.api(p, { method: m, token: S.token, body: b })).status, 403, m + ' ' + p);
  for (const [m, p, b] of [['POST', `/api/sessions/${sess.id}/end`], ['DELETE', `/api/sessions/${sess.id}`], ['PATCH', `/api/classrooms/${cls.id}`, { name: 'Hacked' }], ['DELETE', `/api/classrooms/${cls.id}`], ['POST', `/api/classrooms/${cls.id}/vocab`, { heard: 'a', replacement: 'b' }]])
    assert.equal((await h.api(p, { method: m, token: otherTeacher.token, body: b })).status, 404, 'other teacher ' + m + ' ' + p);
  assert.equal((await get(`/api/classrooms/${cls.id}`, T)).body.name, 'Biology 9');
});

test('captions are stored, vocabulary-corrected, and transcripts need classroom membership', async () => {
  await h.api(`/api/classrooms/${cls.id}/vocab`, { method: 'POST', token: T.token, body: { heard: 'might a conjure', replacement: 'mitochondria' } });
  const ws = await h.connect(T, sess.id);
  const lines = ['The might a conjure is the powerhouse of the cell.', 'Photosynthesis happens in chloroplasts.', 'Mitochondria produce ATP through respiration.'];
  lines.forEach((text, i) => send(ws, { type: 'caption', source: 'speech', final: true, text, cid: 'cid-line-' + i }));
  await waitFor(() => ws.msgs.filter(m => m.type === 'caption').length === 3);
  const full = await get(`/api/sessions/${sess.id}`, S); assert.equal(full.status, 200); assert.equal(full.body.captionCount, 3);
  assert.equal((await get(`/api/sessions/${sess.id}`, outsider)).status, 404);          // not enrolled (left)
  assert.equal((await get(`/api/sessions/${sess.id}`, otherTeacher)).status, 404);
  assert.equal((await get(`/api/sessions/${sess.id}/captions`, outsider)).status, 404);
  assert.equal((await get(`/api/sessions/${sess.id}/export?format=txt`, outsider)).status, 404);
  assert.equal((await get(`/api/sessions/${sess.id}/ai-summary`, outsider)).status, 404);
  assert.equal((await get(`/api/sessions/${sess.id}`, { token: null })).status, 401);
  const caps = (await get(`/api/sessions/${sess.id}/captions`, S)).body;
  assert.match(caps.items[0].text, /mitochondria is the powerhouse/);
  assert.equal(caps.items.length, 3);
  ws.close();
});

test('caption pagination uses an id cursor', async () => {
  const p1 = (await get(`/api/sessions/${sess.id}/captions?limit=2`, S)).body;
  assert.equal(p1.items.length, 2); assert.ok(p1.nextAfter);
  const p2 = (await get(`/api/sessions/${sess.id}/captions?limit=2&after=${p1.nextAfter}`, S)).body;
  assert.equal(p2.items.length, 1); assert.equal(p2.nextAfter, null);
  assert.equal((await get(`/api/sessions/${sess.id}/captions?limit=9999&after=abc`, S)).status, 200);   // bad params are clamped, not errors
});

test('ending a lesson, then exports are correct and filenames safe', async () => {
  await h.api(`/api/sessions/${sess.id}/end`, { method: 'POST', token: T.token });
  const srt = await get(`/api/sessions/${sess.id}/export?format=srt`, S); assert.match(srt.body, /^1\n00:00:00,\d{3} --> /); assert.match(srt.body, /mitochondria is the powerhouse/);
  const vtt = await get(`/api/sessions/${sess.id}/export?format=vtt`, S); assert.match(vtt.body, /^WEBVTT/);
  const txt = await get(`/api/sessions/${sess.id}/export?format=txt`, T); assert.match(txt.body, /Ms Rao: Photosynthesis/);
  assert.equal(srt.headers.get('content-disposition'), 'attachment; filename="Cells_Energy.srt"');
  assert.equal((await get(`/api/sessions/${sess.id}/export?format=exe`, S)).status, 400);
  const evil = await h.live(T, await h.classroom(T, 'Evil'), '../../etc/passwd "\r\nX: y');
  await h.api(`/api/sessions/${evil.id}/end`, { method: 'POST', token: T.token });
  const cd = (await get(`/api/sessions/${evil.id}/export?format=txt`, T)).headers.get('content-disposition'); assert.match(cd, /^attachment; filename="[\w\-]+\.txt"$/);
  assert.equal((await get(`/api/sessions/${sess.id}/ws-ticket`, S).then(r => r)).status, 404);   // GET not allowed route
  assert.equal((await h.api(`/api/sessions/${sess.id}/ws-ticket`, { method: 'POST', token: S.token })).status, 410);
});

test('lecture list: pagination, title/content search, date filter; full-text search across lessons', async () => {
  for (let i = 0; i < 12; i++) { const s = await h.live(T, cls, 'Extra lesson ' + i); await h.api(`/api/sessions/${s.id}/end`, { method: 'POST', token: T.token }); }
  const p1 = (await get(`/api/classrooms/${cls.id}/sessions?pageSize=5`, S)).body;
  assert.equal(p1.items.length, 5); assert.equal(p1.total, 13); assert.equal(p1.pages, 3);
  assert.equal((await get(`/api/classrooms/${cls.id}/sessions?pageSize=5&page=3`, S)).body.items.length, 3);
  assert.equal((await get(`/api/classrooms/${cls.id}/sessions?q=Cells`, S)).body.total, 1);               // title
  assert.equal((await get(`/api/classrooms/${cls.id}/sessions?q=chloroplast`, S)).body.total, 1);        // transcript content
  assert.equal((await get(`/api/classrooms/${cls.id}/sessions?q=photosyn`, S)).body.total, 1);           // prefix
  assert.equal((await get(`/api/classrooms/${cls.id}/sessions?q=${encodeURIComponent('%')}`, S)).body.total, 0);   // wildcard is literal
  assert.equal((await get(`/api/classrooms/${cls.id}/sessions?from=${Date.now() + 100000}`, S)).body.total, 0);
  const found = (await get(`/api/classrooms/${cls.id}/search?q=powerhouse`, S)).body; assert.equal(found.total, 1); assert.equal(found.items[0].session_id, sess.id);
  for (const evil of ['"', 'a" OR "b', 'NEAR(', '* AND', "'; DROP TABLE captions;--"]) assert.equal((await get(`/api/classrooms/${cls.id}/search?q=${encodeURIComponent(evil)}`, S)).status, 200);
  assert.ok(h.ctx.db.prepare('SELECT COUNT(*) n FROM captions').get().n >= 3);
  // search never crosses classrooms
  const c2 = await h.classroom(otherTeacher, 'Other class'); assert.equal((await get(`/api/classrooms/${c2.id}/search?q=powerhouse`, otherTeacher)).body.total, 0);
});

test('dashboards use real backend data', async () => {
  const td = (await get('/api/dashboard', T)).body; assert.equal(td.role, 'teacher'); assert.ok(td.totals.lectures >= 13); assert.ok(td.recent.length > 0); assert.equal(td.totals.students, 1);
  const sd = (await get('/api/dashboard', S)).body; assert.equal(sd.role, 'student'); assert.equal(sd.totals, undefined); assert.ok(sd.classrooms.some(c => c.id === cls.id));
});

test('flags/requests count as participation; confusing lines surface on the transcript', async () => {
  const s2 = await h.live(T, cls, 'Participation'); const ws = await h.connect(S, s2.id), tw = await h.connect(T, s2.id);
  send(tw, { type: 'caption', source: 'speech', final: true, text: 'Osmosis moves water across a membrane.' }); await waitFor(() => ws.msgs.find(m => m.type === 'caption'));
  const id = ws.msgs.find(m => m.type === 'caption').caption.id;
  send(ws, { type: 'flag', captionId: id, kind: 'confusing' }); send(ws, { type: 'request', kind: 'slow_down' }); await waitFor(() => tw.msgs.find(m => m.type === 'flag'));
  await h.api(`/api/sessions/${s2.id}/end`, { method: 'POST', token: T.token });
  const d = (await get(`/api/sessions/${s2.id}`, T)).body; assert.equal(d.confusing[0].n, 1); assert.equal(d.requests.slow_down, 1);
  assert.equal((await get('/api/dashboard', T)).body.recent.find(r => r.id === s2.id).participants, 1); ws.close(); tw.close();
});

test('authorized deletion cascades (captions, FTS index, flags) and other teachers cannot delete', async () => {
  const before = (await get(`/api/classrooms/${cls.id}/search?q=powerhouse`, S)).body.total;
  assert.equal(before, 1);
  assert.equal((await h.api(`/api/sessions/${sess.id}`, { method: 'DELETE', token: otherTeacher.token })).status, 404);
  assert.equal((await h.api(`/api/sessions/${sess.id}`, { method: 'DELETE', token: T.token })).status, 200);
  assert.equal((await get(`/api/sessions/${sess.id}`, T)).status, 404);
  assert.equal((await get(`/api/classrooms/${cls.id}/search?q=powerhouse`, S)).body.total, 0);       // FTS rows removed with the captions
  assert.equal(h.ctx.db.prepare("SELECT COUNT(*) n FROM captions WHERE session_id=?").get(sess.id).n, 0);
});

test('retention: expired ended lessons are purged, live and recent ones are kept', async () => {
  const c = await h.classroom(T, 'Retention'); const keepLive = await h.live(T, c, 'live now');
  const old = h.ctx.db.prepare('INSERT INTO sessions(classroom_id,title,started_at,ended_at) VALUES(?,?,?,?)');
  const day = 86400000; const oldId = old.run(c.id, 'old', Date.now() - 100 * day, Date.now() - 99 * day).lastInsertRowid; const recentId = old.run(c.id, 'recent', Date.now() - 5 * day, Date.now() - 5 * day).lastInsertRowid;
  assert.equal(purgeExpired(h.ctx.db, 0).sessions, 0);                                              // keep-forever by default
  assert.equal((await h.api(`/api/classrooms/${c.id}`, { method: 'PATCH', token: T.token, body: { retention_days: 30 } })).status, 200);
  assert.equal((await h.api(`/api/classrooms/${c.id}`, { method: 'PATCH', token: T.token, body: { retention_days: -5 } })).status, 400);
  assert.equal(purgeExpired(h.ctx.db, 0).sessions, 1);
  const ids = h.ctx.db.prepare('SELECT id FROM sessions WHERE classroom_id=?').all(c.id).map(r => r.id);
  assert.ok(ids.includes(keepLive.id) && ids.includes(recentId) && !ids.includes(oldId));
});

test('deleting a classroom removes everything under it', async () => {
  const c = await h.classroom(T, 'To delete'); const s = await h.live(T, c); await h.api(`/api/sessions/${s.id}/end`, { method: 'POST', token: T.token });
  assert.equal((await h.api(`/api/classrooms/${c.id}`, { method: 'DELETE', token: T.token })).status, 200);
  assert.equal(h.ctx.db.prepare('SELECT COUNT(*) n FROM sessions WHERE classroom_id=?').get(c.id).n, 0);
});
