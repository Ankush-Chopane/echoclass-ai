const test = require('node:test'), assert = require('node:assert');
const { start, wait, send, waitFor } = require('./helpers');

let h, T, S1, S2, X, cls, cls2, sess, sess2;
test.before(async () => {
  h = await start();
  T = await h.user('teacher', 'Teacher'); S1 = await h.user('student', 'Stu One'); S2 = await h.user('student', 'Stu Two'); X = await h.user('student', 'Other Class Kid');
  cls = await h.classroom(T); await h.join(S1, cls); await h.join(S2, cls);
  const T2 = await h.user('teacher', 'Teacher Two'); cls2 = await h.classroom(T2, 'Other'); await h.join(X, cls2);
  sess = await h.live(T, cls); sess2 = await h.live(T2, cls2);
  h.T2 = T2;
});
test.after(() => h.close());
const caps = (ws) => ws.msgs.filter(m => m.type === 'caption').map(m => m.caption);

test('connection security: no token-in-URL, tickets are single-use, outsiders cannot get tickets, bad origin rejected', async () => {
  await assert.rejects(h.rawSocket(`${h.base.replace('http', 'ws')}/ws?token=${T.token}&session=${sess.id}`), { status: 400 });
  const t = (await h.api(`/api/sessions/${sess.id}/ws-ticket`, { method: 'POST', token: S1.token })).body.ticket;
  const ws = await h.rawSocket(`${h.base.replace('http', 'ws')}/ws?ticket=${t}`); ws.close();
  await assert.rejects(h.rawSocket(`${h.base.replace('http', 'ws')}/ws?ticket=${t}`), { status: 401 });          // replay
  await assert.rejects(h.rawSocket(`${h.base.replace('http', 'ws')}/ws?ticket=forged`), { status: 401 });
  await assert.rejects(h.connect(X, sess.id), { status: 404 });                                                    // student of another class
  await assert.rejects(h.connect(S1, sess2.id), { status: 404 });
  await assert.rejects(h.connect(S1, sess.id, { origin: 'https://evil.example' }), { status: 403 });             // cross-site WebSocket hijacking
  const ok = await h.connect(S1, sess.id, { origin: h.base }); ok.close();
  assert.equal((await h.api(`/api/sessions/${sess.id}/ws-ticket`, { method: 'POST' })).status, 401);
});

test('interim and final captions are separate events; only finals persist; delivery reaches every student', async () => {
  const [tw, a, b] = [await h.connect(T, sess.id), await h.connect(S1, sess.id), await h.connect(S2, sess.id)];
  send(tw, { type: 'caption', source: 'speech', final: false, text: 'the cell is' });
  await waitFor(() => b.msgs.some(m => m.type === 'interim'));
  assert.equal(h.ctx.db.prepare('SELECT COUNT(*) n FROM captions WHERE session_id=?').get(sess.id).n, 0);
  assert.equal(tw.msgs.some(m => m.type === 'interim'), false);                                                    // sender does not echo its own interim
  send(tw, { type: 'caption', source: 'speech', final: true, text: 'The cell is the basic unit of life.', cid: 'cid-aaaaaa-1' });
  await waitFor(() => caps(a).length === 1 && caps(b).length === 1);
  assert.equal(caps(a)[0].text, 'The cell is the basic unit of life.'); assert.equal(caps(b)[0].speaker, 'Teacher');
  const ack = await waitFor(() => tw.msgs.find(m => m.type === 'ack')); assert.equal(ack.cid, 'cid-aaaaaa-1'); assert.equal(ack.duplicate, false);
  [tw, a, b].forEach(w => w.close());
});

test('duplicate finals are not stored twice (same client id, or recogniser repeating itself)', async () => {
  const tw = await h.connect(T, sess.id), a = await h.connect(S1, sess.id);
  const before = h.ctx.db.prepare('SELECT COUNT(*) n FROM captions WHERE session_id=?').get(sess.id).n;
  const msg = { type: 'caption', source: 'speech', final: true, text: 'Dedupe me please.', cid: 'cid-dup-0001' };
  send(tw, msg); send(tw, msg); await wait(200);
  send(tw, { ...msg, cid: 'cid-dup-0002' }); await wait(200);                                     // same text within 1.5s, different cid
  assert.equal(h.ctx.db.prepare('SELECT COUNT(*) n FROM captions WHERE session_id=?').get(sess.id).n, before + 1);
  assert.equal(tw.msgs.filter(m => m.type === 'ack' && m.duplicate).length, 2);
  // reconnect + resend with the same cid (client retry after dropped ack) is also deduped
  const tw2 = await h.connect(T, sess.id); send(tw2, { ...msg, text: 'Different text same cid' }); await wait(200);
  assert.equal(h.ctx.db.prepare('SELECT COUNT(*) n FROM captions WHERE session_id=?').get(sess.id).n, before + 1);
  [tw, tw2, a].forEach(w => w.close());
});

test('role-based event authorisation and source rules', async () => {
  const tw = await h.connect(T, sess.id), a = await h.connect(S1, sess.id), b = await h.connect(S2, sess.id);
  const n0 = h.ctx.db.prepare('SELECT COUNT(*) n FROM captions WHERE session_id=?').get(sess.id).n;
  send(a, { type: 'caption', source: 'speech', final: true, text: 'student pretending to be the teacher' });   // students cannot send speech
  send(tw, { type: 'caption', source: 'sign', final: true, text: 'teacher faking a sign' });                    // teachers cannot send sign
  send(tw, { type: 'request', kind: 'raise_hand' }); send(tw, { type: 'flag', captionId: 1, kind: 'confusing' });
  send(a, { type: 'caption', source: 'sign', final: true, text: 'I have a question.' });
  send(b, { type: 'caption', source: 'student', final: true, text: 'typed by student' });
  await waitFor(() => caps(tw).length === 2);
  assert.equal(h.ctx.db.prepare('SELECT COUNT(*) n FROM captions WHERE session_id=?').get(sess.id).n, n0 + 2);
  assert.deepEqual(caps(tw).map(c => c.source).sort(), ['sign', 'student']);
  assert.ok(a.msgs.some(m => m.type === 'error') && tw.msgs.some(m => m.type === 'error'));
  assert.equal(h.ctx.db.prepare('SELECT COUNT(*) n FROM requests WHERE session_id=?').get(sess.id).n, 0);
  [tw, a, b].forEach(w => w.close());
});

test('invalid payloads are rejected without crashing; repeated abuse disconnects', async () => {
  const tw = await h.connect(T, sess.id), a = await h.connect(S1, sess.id);
  for (const bad of ['not json', '[]', '{"type":5}', '{"type":"caption"}', '{"type":"caption","source":"speech","text":123,"final":true}', '{"type":"caption","source":"nope","text":"x","final":true}', '{"type":"flag","kind":"confusing","captionId":"1"}', '{"type":"flag","kind":"confusing","captionId":999999}', '{"type":"request","kind":"explode"}', '{"type":"caption","source":"speech","final":true,"text":"ok text","cid":"bad cid!"}'])
    (bad === 'not json' || bad === '[]' ? tw : a).send(bad);
  await wait(250);
  assert.ok(tw.msgs.filter(m => m.type === 'error').length >= 2); assert.ok(a.msgs.filter(m => m.type === 'error').length >= 5);
  const closed = new Promise(r => a.on('close', c => r(c)));
  for (let i = 0; i < 25; i++) a.send('{"type":"bogus"}');
  assert.equal(await closed, 1008);
  tw.on('error', () => {});
  tw.send(Buffer.alloc(70000, 'a'));                                                                               // over the 64 KB payload cap
  assert.equal(await new Promise(r => tw.on('close', c => r(c))), 1009);
  const alive = await h.connect(T, sess.id); send(alive, { type: 'ping' }); await waitFor(() => alive.msgs.some(m => m.type === 'pong')); alive.close();
});

test('message rate limiting protects the room', async () => {
  const a = await h.connect(S1, sess.id);
  for (let i = 0; i < 80; i++) send(a, { type: 'ping' });
  await waitFor(() => a.msgs.some(m => m.type === 'error' && m.code === 'rate_limited')); a.close();
});

test('student requests have a cooldown; flags are idempotent per student and broadcast once', async () => {
  const tw = await h.connect(T, sess.id), a = await h.connect(S1, sess.id);
  send(a, { type: 'request', kind: 'slow_down' }); send(a, { type: 'request', kind: 'slow_down' }); send(a, { type: 'request', kind: 'repeat' });
  await waitFor(() => tw.msgs.filter(m => m.type === 'request').length === 2); await wait(150);
  assert.equal(tw.msgs.filter(m => m.type === 'request').length, 2);
  const capId = h.ctx.db.prepare('SELECT id FROM captions WHERE session_id=? LIMIT 1').get(sess.id).id;
  send(a, { type: 'flag', captionId: capId, kind: 'confusing' }); send(a, { type: 'flag', captionId: capId, kind: 'confusing' });
  await waitFor(() => tw.msgs.some(m => m.type === 'flag')); await wait(150);
  assert.equal(tw.msgs.filter(m => m.type === 'flag').length, 1); [tw, a].forEach(w => w.close());
});

test('classrooms are isolated: nothing from one room reaches another', async () => {
  const T2 = h.T2, t2 = await h.connect(T2, sess2.id), xs = await h.connect(X, sess2.id), s1 = await h.connect(S1, sess.id), t1 = await h.connect(T, sess.id);
  send(t1, { type: 'caption', source: 'speech', final: true, text: 'Secret lesson from class one.' }); send(t2, { type: 'caption', source: 'speech', final: true, text: 'Class two content here.' });
  await waitFor(() => caps(xs).length === 1 && caps(s1).some(c => /Secret/.test(c.text))); await wait(150);
  assert.ok(caps(xs).every(c => !/Secret/.test(c.text))); assert.ok(caps(s1).every(c => !/Class two/.test(c.text)));
  assert.ok(s1.msgs.find(m => m.type === 'presence')?.users.every(u => u.name !== 'Other Class Kid'));
  [t2, xs, s1, t1].forEach(w => w.close());
});

test('reconnection: a new ticket restores history; sockets of the same user are capped', async () => {
  const a = await h.connect(S1, sess.id); const init = a.msgs.find(m => m.type === 'init'); assert.ok(init.captions.length >= 3); assert.ok(init.captions.every(c => typeof c.id === 'number'));
  a.terminate(); await wait(100);
  const b = await h.connect(S1, sess.id); await waitFor(() => b.msgs.find(m => m.type === 'init')); assert.equal(b.msgs.find(m => m.type === 'init').captions.length, init.captions.length);
  const socks = []; for (let i = 0; i < 6; i++) socks.push(await h.connect(S1, sess.id)); await wait(200);
  assert.ok(socks.filter(s => s.readyState === 1).length <= 4); [b, ...socks].forEach(w => w.close());
});

test('ending a lesson notifies and closes sockets; ended lessons refuse new connections and messages', async () => {
  const tw = await h.connect(T, sess.id), a = await h.connect(S1, sess.id);
  const closed = new Promise(r => a.on('close', c => r(c)));
  await h.api(`/api/sessions/${sess.id}/end`, { method: 'POST', token: T.token });
  await waitFor(() => a.msgs.some(m => m.type === 'ended')); assert.equal(await closed, 1000);
  await assert.rejects(h.connect(S1, sess.id), { status: 410 }); tw.close();
});

test('signing out everywhere disconnects live sockets', async () => {
  const s3 = await h.user('student'); await h.join(s3, cls2); const live = await h.live(h.T2, cls2, 'second'); // returns the existing active session
  const ws = await h.connect(s3, live.id); const closed = new Promise(r => ws.on('close', c => r(c)));
  await h.api('/api/auth/logout-all', { method: 'POST', token: s3.token }); assert.equal(await closed, 4001);
});
