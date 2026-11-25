const test = require('node:test'), assert = require('node:assert');
const { start } = require('./helpers');
const { load, ConfigError } = require('../src/config');

test('health check reports DB status and no secrets', async () => {
  const h = await start({ JWT_SECRET: 'super-secret-value-that-is-long-enough!!' }); const r = await h.api('/health');
  assert.equal(r.status, 200); assert.equal(r.body.ok, true); assert.equal(r.body.db, 'ok'); assert.ok(!JSON.stringify(r.body).includes('super-secret'));
  h.ctx.db.close(); assert.equal((await h.api('/health')).status, 503); await h.close();
});

test('production config validation produces actionable errors', () => {
  const prodBase = { NODE_ENV: 'production', DATABASE_PATH: ':memory:' };
  assert.throws(() => load(prodBase), (e) => e instanceof ConfigError && /JWT_SECRET is required/.test(e.message) && /TEACHER_INVITE_CODE/.test(e.message));
  assert.throws(() => load({ ...prodBase, JWT_SECRET: 'short', TEACHER_INVITE_CODE: 'invite-12345' }), /at least 32/);
  assert.throws(() => load({ ...prodBase, JWT_SECRET: 'change-me'.padEnd(40, '!'), TEACHER_INVITE_CODE: 'x' }), /TEACHER_INVITE_CODE must be at least 8/);
  assert.throws(() => load({ ...prodBase, JWT_SECRET: 'a'.repeat(40), ALLOW_OPEN_TEACHER_SIGNUP: 'true', PORT: 'abc' }), /PORT/);
  const ok = load({ ...prodBase, JWT_SECRET: 'a'.repeat(40), TEACHER_INVITE_CODE: 'invite-12345', PUBLIC_URL: 'https://echo.example.com/' });
  assert.equal(ok.isProd, true); assert.deepEqual(ok.allowedOrigins, ['https://echo.example.com']); assert.equal(ok.trustProxy, 1); assert.equal(ok.ai.provider, 'none');
  const dev = load({}, { warn: () => {} }); assert.ok(dev.jwtSecret.length >= 32); assert.equal(dev.allowOpenTeacherSignup, true);
  const unwritableDbPath = process.platform === 'win32' ? 'Z:\\nonexistent\\sub\\echo.db' : '/etc/hostname/sub/echo.db';
  assert.throws(() => load({ DATABASE_PATH: unwritableDbPath }), /not writable/);
});

test('production error responses never leak stack traces; malformed and oversized bodies are clean 4xx', async () => {
  const h = await start({ NODE_ENV: 'production', JWT_SECRET: 'a'.repeat(40), TEACHER_INVITE_CODE: 'invite-12345' }, { mount: (app) => app.get('/boom', () => { throw new Error('secret internals /etc/passwd'); }) });
  try {
  const boom = await h.api('/boom'); assert.equal(boom.status, 500); assert.ok(!JSON.stringify(boom.body).includes('internals')); assert.ok(!JSON.stringify(boom.body).includes('at '));
  assert.equal((await h.api('/api/auth/login', { method: 'POST', raw: '{oops', headers: { 'Content-Type': 'application/json' } })).status, 400);
  assert.equal((await h.api('/api/auth/login', { method: 'POST', raw: JSON.stringify({ email: 'a'.repeat(200000) }), headers: { 'Content-Type': 'application/json' } })).status, 413);
  assert.equal((await h.api('/api/nope')).status, 404);
  const hdr = (await h.api('/api/config')).headers;
  assert.match(hdr.get('content-security-policy'), /default-src 'self'/); assert.match(hdr.get('content-security-policy'), /frame-ancestors 'none'/); assert.equal(hdr.get('x-content-type-options'), 'nosniff'); assert.equal(hdr.get('x-frame-options'), 'DENY'); assert.equal(hdr.get('x-powered-by'), null);
  } finally { await h.close(); }
});

test('CORS: same-origin by default; only explicitly allowed origins get headers', async () => {
  const h = await start({ ALLOWED_ORIGINS: 'https://app.example.com' });
  const ok = await h.api('/api/config', { headers: { Origin: 'https://app.example.com' } }); assert.equal(ok.headers.get('access-control-allow-origin'), 'https://app.example.com');
  const no = await h.api('/api/config', { headers: { Origin: 'https://evil.example' } }); assert.equal(no.headers.get('access-control-allow-origin'), null);
  const pre = await fetch(h.base + '/api/classrooms', { method: 'OPTIONS', headers: { Origin: 'https://app.example.com', 'Access-Control-Request-Method': 'GET' } }); assert.equal(pre.status, 204);
  await h.close();
});

test('static assets: MediaPipe wasm + module served with correct types; path traversal blocked', async () => {
  const h = await start(); try {
  const mjs = await fetch(h.base + '/vendor/mediapipe/vision_bundle.mjs'); assert.equal(mjs.status, 200); assert.match(mjs.headers.get('content-type'), /javascript/);
  const wasm = await fetch(h.base + '/vendor/mediapipe/wasm/vision_wasm_internal.wasm'); assert.equal(wasm.status, 200); assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.notEqual((await fetch(h.base + '/%2e%2e/src/config.js')).status, 200);
  assert.notEqual((await fetch(h.base + '/vendor/mediapipe/%2e%2e/%2e%2e/package.json')).status, 200);
  } finally { await h.close(); }
});

test('built React app: static files + SPA fallback for client routes; API and files still 404 correctly', async () => {
  const dir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'dist-'));
  require('fs').mkdirSync(dir + '/assets'); require('fs').writeFileSync(dir + '/index.html', '<!doctype html><title>EchoClass AI</title><div id="root"></div>'); require('fs').writeFileSync(dir + '/assets/app-1.js', 'console.log(1)');
  const h = await start({ STATIC_DIR: dir }); try {
    for (const route of ['/', '/login', '/classrooms/3/live', '/transcripts/9']) { const r = await fetch(h.base + route); assert.equal(r.status, 200, route); assert.match(await r.text(), /id="root"/); }
    const js = await fetch(h.base + '/assets/app-1.js'); assert.equal(js.status, 200); assert.match(js.headers.get('cache-control'), /immutable/);
    assert.equal((await fetch(h.base + '/assets/missing.js')).status, 404);
    assert.equal((await fetch(h.base + '/api/nope')).status, 404);
    assert.equal((await fetch(h.base + '/health')).status, 200);
    const csp = (await fetch(h.base + '/')).headers.get('content-security-policy'); assert.match(csp, /font-src 'self'/);
  } finally { await h.close(); }
});

test('without a built frontend the server stays up and says how to build it', async () => {
  const h = await start({ STATIC_DIR: require('os').tmpdir() + '/definitely-missing-dist' }); try {
    const r = await fetch(h.base + '/login'); assert.equal(r.status, 503); assert.match(await r.text(), /build:classroom/);
    assert.equal((await fetch(h.base + '/health')).status, 200);
  } finally { await h.close(); }
});

test('graceful close is idempotent and releases the port', async () => {
  const h = await start(); await h.close(); await h.close();
  await assert.rejects(fetch(h.base + '/health'));
});
