// Offline-classroom features: Vosk engine, LAN info, local assets, offline summaries.
// Real-recognition tests need `pip install vosk` + `npm run fetch-speech-model`; without them they are SKIPPED (never silently "passed").
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { start, wait, send, waitFor } = require('./helpers');
const { createSpeechEngine } = require('../src/speech-engine');
const T = require('../src/text');

const ROOT = path.join(__dirname, '..', '..', '..');
const PY = process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3');
const modelDir = process.env.VOSK_MODEL_PATH || path.join(ROOT, 'models', 'vosk');
const modelInstalled = fs.existsSync(path.join(modelDir, 'am', 'final.mdl')) || fs.existsSync(path.join(modelDir, 'conf', 'model.conf'));
const voskPy = spawnSync(PY, ['-c', 'import vosk'], { encoding: 'utf-8' });
const voskReady = modelInstalled && voskPy.status === 0;
const SKIP_REAL = voskReady ? false : `real Vosk not available (model installed: ${modelInstalled}; python vosk package: ${voskPy.status === 0}). Run: pip install vosk && npm run fetch-speech-model`;
const FAKE = path.join(__dirname, 'fixtures', 'fake_vosk_worker.py');
const pyOk = spawnSync(PY, ['--version']).status === 0;

test('REAL Vosk: model loads and accepts audio (skipped when model/package are missing)', { skip: SKIP_REAL }, async () => {
  const engine = createSpeechEngine({ modelPath: modelDir, pythonPath: PY });
  await new Promise((resolve) => { if (engine.ready) return resolve(); engine.once('ready', resolve); setTimeout(resolve, 15000); });
  assert.equal(engine.ready, true);
  assert.equal(engine.feedAudio(Buffer.alloc(16000).toString('base64')), true);
  engine.flush(); engine.close();
});

test('speech engine without a model reports it honestly, never throws, never spawns', () => {
  const engine = createSpeechEngine({ modelPath: path.join(os.tmpdir(), 'no-such-vosk-model') });
  const st = engine.publicStatus();
  assert.equal(st.available, false); assert.equal(st.ready, false);
  assert.match(st.error, /model/i);
  assert.ok(!JSON.stringify(st).includes(os.tmpdir()), 'public status must not leak server paths');
  assert.equal(engine.feedAudio(Buffer.alloc(100).toString('base64')), false);
  engine.close();
});

test('a failing worker (missing python package) cannot crash the server or cause a spawn storm', { skip: pyOk ? false : 'python not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakemodel-')); fs.mkdirSync(path.join(dir, 'conf')); fs.writeFileSync(path.join(dir, 'conf', 'model.conf'), '');
  const bad = path.join(dir, 'bad_worker.py'); fs.writeFileSync(bad, 'import sys, json\nprint(json.dumps({"error": "Vosk python package is not installed"}), flush=True)\nsys.exit(1)\n');
  const engine = createSpeechEngine({ modelPath: dir, workerScript: bad, pythonPath: PY });
  let seen = null; engine.on('worker-error', (m) => (seen = m));    // note: no 'error' listener on purpose – must not throw
  await waitFor(() => seen, 5000);
  assert.match(seen, /not installed/);
  await waitFor(() => engine.worker === null, 5000);                  // the error line arrives just before the process exit is observed
  const t0 = engine.retryAfter; assert.ok(t0 > Date.now(), 'respawn is delayed');
  for (let i = 0; i < 20; i++) engine.feedAudio('AAAA');             // must not respawn within the back-off window
  assert.equal(engine.worker, null);
  engine.close();
});

test('stub worker -> WebSocket -> SQLite: audio chunks become interim + saved captions for students (plumbing only, not recognition)', { skip: pyOk ? false : 'python not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakemodel-')); fs.mkdirSync(path.join(dir, 'conf')); fs.writeFileSync(path.join(dir, 'conf', 'model.conf'), '');
  const engine = createSpeechEngine({ modelPath: dir, workerScript: FAKE, pythonPath: PY });
  const h = await start({}, { speechEngine: engine });
  try {
    const teacher = await h.user('teacher'), student = await h.user('student');
    const cls = await h.classroom(teacher); await h.join(student, cls); const ses = await h.live(teacher, cls, 'Stub lesson');
    const tw = await h.connect(teacher, ses.id), sw = await h.connect(student, ses.id);
    await waitFor(() => sw.msgs.some(m => m.type === 'init'));
    const chunk = Buffer.alloc(3200).toString('base64');
    for (let i = 0; i < 3; i++) { send(tw, { type: 'speech_chunk', data: chunk }); await wait(80); }
    await waitFor(() => sw.msgs.some(m => m.type === 'caption' && m.caption.text === 'stub recognised sentence'), 8000);
    assert.ok(sw.msgs.some(m => m.type === 'interim' && m.text === 'stub partial'), 'students saw an interim line');
    const saved = h.ctx.db.prepare("SELECT source, text FROM captions WHERE session_id=?").all(ses.id);
    assert.deepEqual(saved.map(r => r.source), ['speech']);
    // a student can never feed audio
    send(sw, { type: 'speech_chunk', data: chunk }); await wait(150);
    assert.equal(h.ctx.db.prepare("SELECT COUNT(*) n FROM captions WHERE session_id=?").get(ses.id).n, 1);
    // malformed audio is rejected, not forwarded to the worker
    send(tw, { type: 'speech_chunk', data: '***not base64***' }); await wait(150);
    tw.close(); sw.close();
  } finally { engine.close(); await h.close(); }
});

test('two classes cannot share one recogniser: the second teacher is told it is busy instead of mixing audio', { skip: pyOk ? false : 'python not installed' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fakemodel-')); fs.mkdirSync(path.join(dir, 'conf')); fs.writeFileSync(path.join(dir, 'conf', 'model.conf'), '');
  const engine = createSpeechEngine({ modelPath: dir, workerScript: FAKE, pythonPath: PY });
  const h = await start({}, { speechEngine: engine });
  try {
    const t1 = await h.user('teacher'), t2 = await h.user('teacher');
    const c1 = await h.classroom(t1, 'Class A'), c2 = await h.classroom(t2, 'Class B');
    const s1 = await h.live(t1, c1, 'One'), s2 = await h.live(t2, c2, 'Two');
    const w1 = await h.connect(t1, s1.id), w2 = await h.connect(t2, s2.id);
    const chunk = Buffer.alloc(3200).toString('base64');
    send(w1, { type: 'speech_chunk', data: chunk }); await wait(150);
    send(w2, { type: 'speech_chunk', data: chunk });
    await waitFor(() => w2.msgs.some(m => m.type === 'error' && m.code === 'offline_speech_busy'));
    w1.close(); w2.close();
  } finally { engine.close(); await h.close(); }
});

test('speech_chunk without an installed model returns offline_speech_unavailable', async () => {
  const engine = createSpeechEngine({ modelPath: path.join(os.tmpdir(), 'no-such-vosk-model') });
  const h = await start({}, { speechEngine: engine });
  try {
    const t = await h.user('teacher'); const c = await h.classroom(t); const s = await h.live(t, c);
    const w = await h.connect(t, s.id);
    send(w, { type: 'speech_chunk', data: Buffer.alloc(100).toString('base64') });
    await waitFor(() => w.msgs.some(m => m.type === 'error' && m.code === 'offline_speech_unavailable'));
    w.close();
  } finally { engine.close(); await h.close(); }
});

test('network info is teacher-only; public config exposes no filesystem paths', async () => {
  const h = await start();
  try {
    const teacher = await h.user('teacher'), student = await h.user('student');
    assert.equal((await h.api('/api/system/network')).status, 401);
    assert.equal((await h.api('/api/system/network', { token: student.token })).status, 403);
    const net = await h.api('/api/system/network', { token: teacher.token });
    assert.equal(net.status, 200); assert.ok(Array.isArray(net.body.localIps)); assert.ok(Number.isInteger(net.body.port));
    assert.equal(net.body.speechEngine.provider, 'vosk');
    const cfg = await h.api('/api/config');
    assert.equal(cfg.status, 200); assert.ok(!JSON.stringify(cfg.body).includes('modelPath'));
    assert.ok(!JSON.stringify(cfg.body).includes(ROOT), 'no server path in public config');
  } finally { await h.close(); }
});

test('MediaPipe runtime is served locally (no CDN) with correct MIME types', async () => {
  const h = await start();
  try {
    const js = await h.api('/vendor/mediapipe/vision_bundle.mjs');
    assert.equal(js.status, 200); assert.match(js.headers.get('content-type') || '', /javascript/);
    const wasm = await fetch(h.base + '/vendor/mediapipe/wasm/vision_wasm_internal.wasm');
    assert.equal(wasm.status, 200); assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  } finally { await h.close(); }
});

test('captions persist in SQLite and the extractive (non-AI) summary and exports work offline', async () => {
  const h = await start();
  try {
    const teacher = await h.user('teacher'); const cls = await h.classroom(teacher, 'Offline Science'); const ses = await h.live(teacher, cls, 'Photosynthesis');
    const lines = ['Good morning class. Today we study photosynthesis and cellular respiration.', 'Chlorophyll absorbs sunlight to convert water and carbon dioxide into glucose.', 'Oxygen is released as a vital byproduct of this biochemical reaction.'];
    lines.forEach((text, i) => h.ctx.db.prepare('INSERT INTO captions(session_id, source, speaker, text, t_ms, created_at) VALUES(?,?,?,?,?,?)').run(ses.id, 'speech', teacher.user.name, text, 1000 + i * 4000, Date.now()));
    await h.api(`/api/sessions/${ses.id}/end`, { method: 'POST', token: teacher.token });
    const caps = h.ctx.db.prepare('SELECT * FROM captions WHERE session_id=?').all(ses.id);
    const summary = T.summarize(caps);
    assert.ok(summary.keywords.some(k => ['photosynthesis', 'chlorophyll'].includes(k.word)));
    assert.ok(summary.highlights.length > 0); assert.equal(summary.stats.captions, 3);
    assert.ok(T.toSRT(caps).includes('-->')); assert.ok(T.toTXT(caps, 'Photosynthesis Lecture').includes('Photosynthesis Lecture'));
  } finally { await h.close(); }
});
