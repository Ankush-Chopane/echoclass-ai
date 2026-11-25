const test = require('node:test'), assert = require('node:assert');
const T = require('../src/text');

const caps = [
  { id: 1, source: 'speech', speaker: 'Ms Rao', text: 'Photosynthesis is the process plants use to make glucose from sunlight.', t_ms: 1000 },
  { id: 2, source: 'speech', speaker: 'Ms Rao', text: 'Chlorophyll absorbs sunlight inside the chloroplasts of plant cells. Glucose stores the energy.', t_ms: 9000 },
  { id: 3, source: 'sign', speaker: 'Aarav', text: 'I have a question.', t_ms: 12000 },
  { id: 4, source: 'student', speaker: 'Aarav', text: 'Typed: what is glucose?', t_ms: 13000 },
];

test('summary: keywords come from teacher speech only; stats are correct', () => {
  const s = T.summarize(caps);
  assert.ok(s.keywords.find(k => k.word === 'sunlight' && k.count === 2)); assert.ok(!s.keywords.some(k => k.word === 'question'));
  assert.equal(s.stats.captions, 4); assert.equal(s.stats.signCaptions, 1); assert.equal(s.stats.studentMessages, 1); assert.equal(s.stats.durationMs, 13000);
  assert.ok(s.highlights.length >= 1 && s.highlights.length <= 5); assert.ok(s.highlights.every(h => typeof h.text === 'string'));
});

test('empty and malformed transcripts never throw', () => {
  for (const bad of [[], null, undefined, 'x', 5, {}, [null], [{}], [{ text: 5 }], [{ text: '  ' }], [{ text: 'ok words here now', t_ms: -5 }], [{ text: 'a b c d e f', t_ms: 'NaN' }]]) {
    assert.doesNotThrow(() => { T.summarize(bad); T.toSRT(bad); T.toVTT(bad); T.toTXT(bad, 'T'); T.transcriptForAi(bad, 1000); }, JSON.stringify(bad));
  }
  const s = T.summarize([]); assert.equal(s.stats.words, 0); assert.deepEqual(s.keywords, []);
  assert.equal(T.toSRT([]), ''); assert.equal(T.toVTT([]), 'WEBVTT\n\n'); assert.match(T.toTXT([], 'Empty'), /^Empty\n=====/);
});

test('SRT: numbered cues, comma timestamps, never overlapping or inverted', () => {
  const out = T.toSRT(caps); const blocks = out.trim().split('\n\n'); assert.equal(blocks.length, 4);
  assert.match(blocks[0], /^1\n00:00:01,000 --> 00:00:08,000\nPhotosynthesis/);                      // capped at 7s
  assert.match(blocks[2], /\[Sign – Aarav\] I have a question\./);
  const times = [...out.matchAll(/(\d\d):(\d\d):(\d\d),(\d{3}) --> (\d\d):(\d\d):(\d\d),(\d{3})/g)].map(m => [(+m[1]) * 3600000 + (+m[2]) * 60000 + (+m[3]) * 1000 + +m[4], (+m[5]) * 3600000 + (+m[6]) * 60000 + (+m[7]) * 1000 + +m[8]]);
  times.forEach(([a, b]) => assert.ok(b > a));
});

test('VTT: header, dot timestamps, and cue text cannot inject markup or break the format', () => {
  const evil = [{ source: 'speech', speaker: 'T', text: 'Line one\n\nline two --> <script>alert(1)</script> & more', t_ms: 0 }];
  const vtt = T.toVTT(evil); assert.match(vtt, /^WEBVTT\n\n00:00:00\.000 --> 00:00:04\.000\n/);
  assert.ok(!vtt.includes('<script>')); assert.ok(!/\n\n.*line two/.test(vtt)); assert.equal(vtt.split('-->').length, 2);   // only the cue arrow remains
  const srt = T.toSRT(evil); assert.equal(srt.split('-->').length, 2);
});

test('TXT export labels sources', () => {
  const t = T.toTXT(caps, 'Biology'); assert.match(t, /^Biology\n=======\n/); assert.match(t, /\[00:00:12\] \(sign\) Aarav: I have a question\./); assert.match(t, /\(student\) Aarav: Typed/);
});

test('vocabulary corrections respect word boundaries, case, and regex characters', () => {
  const v = [{ heard: 'might a conjure', replacement: 'mitochondria' }, { heard: 'c++', replacement: 'C plus plus' }, { heard: 'cat', replacement: 'DOG' }];
  assert.equal(T.applyVocab('The Might A Conjure and the cat sat; concatenate stays. I like c++!', v), 'The mitochondria and the DOG sat; concatenate stays. I like C plus plus!');
  assert.equal(T.applyVocab('anything', []), 'anything');
});

test('AI transcript builder: teacher captions only, bounded length, flags truncation', () => {
  const r = T.transcriptForAi(caps, 10000); assert.equal(r.lines, 2); assert.ok(!r.text.includes('question') && !r.text.includes('Typed')); assert.equal(r.truncated, false);
  const t = T.transcriptForAi(Array.from({ length: 500 }, (_, i) => ({ source: 'speech', speaker: 'T', text: 'sentence number ' + i + ' about biology', t_ms: i * 1000 })), 2000);
  assert.ok(t.text.length <= 2000); assert.equal(t.truncated, true);
});
