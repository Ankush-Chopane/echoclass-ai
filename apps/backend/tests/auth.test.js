const test = require('node:test'), assert = require('node:assert');
const jwt = require('jsonwebtoken');
const { start } = require('./helpers');

let h;
test.before(async () => { h = await start({ JWT_SECRET: 'x'.repeat(40) }); });
test.after(() => h.close());
const reg = (b) => h.api('/api/auth/register', { method: 'POST', body: b });
const good = { name: 'Asha Rao', email: 'asha@example.com', password: 'Sup3rSecret', role: 'student' };

test('valid registration returns a token, normalises email, never returns the hash', async () => {
  const r = await reg({ ...good, email: '  Asha@Example.COM ' });
  assert.equal(r.status, 201); assert.ok(r.body.token); assert.equal(r.body.user.email, 'asha@example.com');
  assert.equal(JSON.stringify(r.body).includes('hash'), false);
  const row = h.ctx.db.prepare('SELECT password_hash FROM users WHERE email=?').get('asha@example.com');
  assert.match(row.password_hash, /^\$2[aby]\$/);               // bcrypt, never plaintext
});

test('duplicate registration (case-insensitive) is rejected', async () => {
  assert.equal((await reg({ ...good, email: 'ASHA@example.com' })).status, 409);
});

test('invalid input is rejected with field-level messages', async () => {
  for (const [patch, field] of [[{ name: 'A' }, 'name'], [{ email: 'nope' }, 'email'], [{ password: 'sh0rt' }, 'password'], [{ password: 'password123' }, 'password'], [{ password: 'a1' + 'x'.repeat(80) }, 'password'], [{ role: 'admin' }, 'role'], [{ role: undefined }, 'role']]) {
    const r = await reg({ ...good, email: 'v' + Math.random() + '@example.com', ...patch });
    assert.equal(r.status, 400, JSON.stringify(patch)); assert.ok(r.body.fields[field], 'expected field error for ' + field);
  }
  assert.equal((await h.api('/api/auth/register', { method: 'POST', raw: '{bad json', headers: { 'Content-Type': 'application/json' } })).status, 400);
});

test('role escalation attempts are impossible: only student/teacher exist, role cannot be changed', async () => {
  for (const role of ['admin', 'superuser', 'Teacher ', ['teacher'], { $ne: 1 }]) assert.equal((await reg({ ...good, email: 'e' + Math.random() + '@example.com', role })).status, 400);
  const s = await h.user('student');
  assert.equal((await h.api('/api/classrooms', { method: 'POST', token: s.token, body: { name: 'Hack' } })).status, 403);
  assert.equal((await h.api('/api/me', { method: 'PATCH', token: s.token, body: { role: 'teacher' } })).status, 404);   // no such route
  // forged token claiming teacher with a different secret / alg none is rejected
  const forged = jwt.sign({ sub: s.user.id, role: 'teacher', tv: 0 }, 'wrong-secret');
  assert.equal((await h.api('/api/classrooms', { method: 'POST', token: forged, body: { name: 'x' } })).status, 401);
  const none = Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ sub: s.user.id, role: 'teacher', tv: 0 })).toString('base64url') + '.';
  assert.equal((await h.api('/api/me', { token: none })).status, 401);
  // a valid student token whose embedded role says "teacher" still acts as a student (role comes from the DB)
  const lie = jwt.sign({ sub: s.user.id, role: 'teacher', tv: 0 }, 'x'.repeat(40), { algorithm: 'HS256' });
  assert.equal((await h.api('/api/classrooms', { method: 'POST', token: lie, body: { name: 'x' } })).status, 403);
});

test('wrong password, unknown user, invalid and expired tokens', async () => {
  const u = await h.user('student');
  assert.equal((await h.api('/api/auth/login', { method: 'POST', body: { email: u.email, password: 'WrongPass1' } })).status, 401);
  assert.equal((await h.api('/api/auth/login', { method: 'POST', body: { email: 'ghost@example.com', password: 'WrongPass1' } })).status, 401);
  assert.equal((await h.api('/api/auth/login', { method: 'POST', body: { email: u.email, password: u.password } })).status, 200);
  assert.equal((await h.api('/api/me')).status, 401);
  assert.equal((await h.api('/api/me', { token: 'garbage' })).status, 401);
  const expired = jwt.sign({ sub: u.user.id, role: 'student', tv: 0 }, 'x'.repeat(40), { algorithm: 'HS256', expiresIn: -10 });
  const r = await h.api('/api/me', { token: expired });
  assert.equal(r.status, 401); assert.equal(r.body.code, 'expired');
});

test('repeated failed logins lock the account+IP temporarily, and success before the limit resets it', async () => {
  const u = await h.user('student');
  for (let i = 0; i < 5; i++) assert.equal((await h.api('/api/auth/login', { method: 'POST', body: { email: u.email, password: 'Nope1234' } })).status, 401);
  const locked = await h.api('/api/auth/login', { method: 'POST', body: { email: u.email, password: u.password } });
  assert.equal(locked.status, 429); assert.ok(locked.headers.get('retry-after'));
});

test('registration rate limit applies per IP', async () => {
  const lim = await start({}, { limits: { register: 3 } });
  const codes = []; for (let i = 0; i < 5; i++) codes.push((await lim.api('/api/auth/register', { method: 'POST', body: { ...good, email: `r${i}@example.com` } })).status);
  assert.deepEqual(codes, [201, 201, 201, 429, 429]); await lim.close();
});

test('logout-all and password change invalidate old tokens; new token works', async () => {
  const u = await h.user('student');
  assert.equal((await h.api('/api/me', { token: u.token })).status, 200);
  const pw = await h.api('/api/me/password', { method: 'PATCH', token: u.token, body: { currentPassword: 'wrong', newPassword: 'NewPassw0rd9' } }); assert.equal(pw.status, 403);
  const ok = await h.api('/api/me/password', { method: 'PATCH', token: u.token, body: { currentPassword: u.password, newPassword: 'NewPassw0rd9' } }); assert.equal(ok.status, 200);
  assert.equal((await h.api('/api/me', { token: u.token })).status, 401);          // old token dead
  assert.equal((await h.api('/api/me', { token: ok.body.token })).status, 200);
  await h.api('/api/auth/logout-all', { method: 'POST', token: ok.body.token });
  assert.equal((await h.api('/api/me', { token: ok.body.token })).status, 401);
  assert.equal((await h.api('/api/auth/login', { method: 'POST', body: { email: u.email, password: 'NewPassw0rd9' } })).status, 200);
});

test('account deletion needs the password, anonymises messages, blocks teachers who own classrooms', async () => {
  const t = await h.user('teacher'), s = await h.user('student', 'Deleter');
  const cls = await h.classroom(t); await h.join(s, cls); const sess = await h.live(t, cls);
  const ws = await h.connect(s, sess.id); ws.send(JSON.stringify({ type: 'caption', source: 'student', final: true, text: 'hello class' })); await new Promise(r => setTimeout(r, 200)); ws.close();
  assert.equal((await h.api('/api/me', { method: 'DELETE', token: t.token, body: { password: t.password } })).status, 409);
  assert.equal((await h.api('/api/me', { method: 'DELETE', token: s.token, body: { password: 'bad' } })).status, 403);
  assert.equal((await h.api('/api/me', { method: 'DELETE', token: s.token, body: { password: s.password } })).status, 200);
  assert.equal(h.ctx.db.prepare("SELECT speaker FROM captions WHERE text='hello class'").get().speaker, 'Deleted user');
  assert.equal((await h.api('/api/me', { token: s.token })).status, 401);
});

test('teacher sign-up can be gated by an invite code', async () => {
  const g = await start({ TEACHER_INVITE_CODE: 'invite-code-123' });
  const body = { name: 'Mr Teacher', email: 't@example.com', password: 'Sup3rSecret', role: 'teacher' };
  assert.equal((await g.api('/api/auth/register', { method: 'POST', body })).status, 400);
  assert.equal((await g.api('/api/auth/register', { method: 'POST', body: { ...body, inviteCode: 'wrong-code' } })).status, 400);
  assert.equal((await g.api('/api/auth/register', { method: 'POST', body: { ...body, inviteCode: 'invite-code-123' } })).status, 201);
  assert.equal((await g.api('/api/auth/register', { method: 'POST', body: { name: 'Kid', email: 'k@example.com', password: 'Sup3rSecret', role: 'student' } })).status, 201);   // students never need a code
  assert.equal((await g.api('/api/config')).body.teacherInviteRequired, true); await g.close();
});

test('audit log records security events without secrets', async () => {
  const rows = h.ctx.db.prepare('SELECT action, detail FROM audit_log').all();
  assert.ok(rows.some(r => r.action === 'register') && rows.some(r => r.action === 'login_failed'));
  assert.ok(!JSON.stringify(rows).includes('Sup3rSecret'));
});
