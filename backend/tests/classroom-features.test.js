// Classroom network, local assets, and transcript utilities.
const test = require('node:test');
const assert = require('node:assert');
const { start } = require('./helpers');
const T = require('../src/text');

test('network info is teacher-only; public config exposes no filesystem paths', async () => {
  const h = await start();
  try {
    const teacher = await h.user('teacher'), student = await h.user('student');
    assert.equal((await h.api('/api/system/network')).status, 401);
    assert.equal((await h.api('/api/system/network', { token: student.token })).status, 403);
    const net = await h.api('/api/system/network', { token: teacher.token });
    assert.equal(net.status, 200); assert.ok(Array.isArray(net.body.localIps)); assert.ok(Number.isInteger(net.body.port));
    const cfg = await h.api('/api/config');
    assert.equal(cfg.status, 200);
    assert.equal('offlineSpeech' in cfg.body, false);
    assert.equal('speechEngine' in net.body, false);
    assert.ok(!JSON.stringify(cfg.body).includes('modelPath'));
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

test('captions persist in SQLite and the extractive (non-AI) summary and exports work without an AI provider', async () => {
  const h = await start();
  try {
    const teacher = await h.user('teacher'); const cls = await h.classroom(teacher, 'Local Science'); const ses = await h.live(teacher, cls, 'Photosynthesis');
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

test('extractive summary skips greetings and sentences with no meaningful terms', () => {
  const summary = T.summarize([
    { source: 'speech', speaker: 'Teacher', text: 'Hello hello.', t_ms: 1000 },
    { source: 'speech', speaker: 'Teacher', text: 'Myself how are you hello hello', t_ms: 2000 }
  ]);
  assert.deepEqual(summary.keywords, []);
  assert.deepEqual(summary.highlights, []);
});
