const WebSocket = require('ws');
const { create } = require('../src/server');

async function start(env = {}, deps = {}) {
  const ctx = await create({ MONGODB_URI: env.MONGODB_URI || 'mongodb://localhost:27017/echoclass_test', ...env }, { limits: { register: 10000, login: 10000 }, ...deps });
  await new Promise(r => ctx.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${ctx.server.address().port}`;
  const api = async (path, { method = 'GET', body, token, headers = {}, raw } = {}) => {
    const r = await fetch(base + path, { method, headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), ...(token && { Authorization: 'Bearer ' + token }), ...headers }, body: raw ?? (body && JSON.stringify(body)) });
    const ct = r.headers.get('content-type') || '';
    return { status: r.status, headers: r.headers, body: ct.includes('json') ? await r.json() : await r.text() };
  };
  let n = 0;
  const user = async (role, name = role + ++n, extra = {}) => {
    const email = `${name.toLowerCase().replace(/\W/g, '')}${Math.random().toString(36).slice(2, 6)}@example.com`;
    const r = await api('/api/auth/register', { method: 'POST', body: { name, email, password: 'Sup3rSecret', role, ...extra } });
    if (r.status !== 201) throw new Error('register failed: ' + JSON.stringify(r.body));
    return { ...r.body, email, password: 'Sup3rSecret', token: r.body.token };
  };
  /** Opens a socket using a fresh single-use ticket. Collects messages in ws.msgs. */
  const connect = async (u, sessionId, { origin } = {}) => {
    const t = await api(`/api/sessions/${sessionId}/ws-ticket`, { method: 'POST', token: u.token });
    if (t.status !== 200) throw Object.assign(new Error('ticket ' + t.status), { status: t.status });
    return rawSocket(`${base.replace('http', 'ws')}/ws?ticket=${t.body.ticket}`, { origin });
  };
  const rawSocket = (url, { origin } = {}) => new Promise((res, rej) => {
    const ws = new WebSocket(url, { headers: origin ? { Origin: origin } : {} });
    ws.msgs = []; ws.on('message', m => ws.msgs.push(JSON.parse(m)));
    ws.on('open', () => res(ws)); ws.on('error', rej); ws.on('unexpected-response', (_, r) => rej(Object.assign(new Error('ws ' + r.statusCode), { status: r.statusCode })));
  });
  const classroom = async (teacher, name = 'Biology 9') => (await api('/api/classrooms', { method: 'POST', token: teacher.token, body: { name } })).body;
  const join = (student, cls) => api('/api/classrooms/join', { method: 'POST', token: student.token, body: { code: cls.code } });
  const live = async (teacher, cls, title = 'Cells') => (await api(`/api/classrooms/${cls.id}/sessions`, { method: 'POST', token: teacher.token, body: { title } })).body;
  const register = async (name, email, password, role) => {
    const r = await api('/api/auth/register', { method: 'POST', body: { name, email, password, role } });
    return { ...r.body, name, email, role, token: r.body.token };
  };
  return { ctx, base, api, user, register, connect, rawSocket, classroom, join, live, close: () => ctx.close() };
}
const wait = (ms = 150) => new Promise(r => setTimeout(r, ms));
const send = (ws, o) => ws.send(JSON.stringify(o));
const waitFor = async (fn, ms = 2000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await wait(20); } throw new Error('waitFor timed out'); };
module.exports = { start, wait, send, waitFor };
