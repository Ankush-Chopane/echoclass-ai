// Summaries, keywords, vocabulary correction and subtitle exports.
const STOP = new Set(('a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its just let me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yes okay like going get got one two really thing things know see say said gonna want').split(' '));

const words = (s) => (s.toLowerCase().match(/[\p{L}\p{N}']+/gu) || []);

function applyVocab(text, vocab) {
  let out = text;
  for (const v of vocab) {
    const esc = v.heard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])`, 'giu'), v.replacement);
  }
  return out;
}

const valid = (caps) => (Array.isArray(caps) ? caps : []).filter(c => c && typeof c.text === 'string' && c.text.trim());
const num = (n) => (Number.isFinite(n) && n >= 0 ? n : 0);

function summarize(captions) {
  captions = valid(captions).map(c => ({ ...c, t_ms: num(c.t_ms), speaker: String(c.speaker ?? 'Unknown'), source: c.source || 'speech' }));
  const speech = captions.filter(c => c.source !== 'sign' && c.source !== 'student');
  const all = captions;
  const totalWords = all.reduce((n, c) => n + words(c.text).length, 0);
  const freq = new Map();
  for (const c of speech) for (const w of words(c.text)) if (w.length > 3 && !STOP.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
  const keywords = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([word, count]) => ({ word, count }));

  const sentences = [];
  for (const c of speech) for (const s of c.text.split(/(?<=[.!?।])\s+/)) if (words(s).length >= 5) sentences.push({ s: s.trim(), t: c.t_ms });
  const scored = sentences.map((x, i) => {
    const ws = words(x.s).filter(w => !STOP.has(w));
    const score = ws.reduce((n, w) => n + (freq.get(w) || 0), 0) / Math.sqrt(ws.length || 1);
    return { ...x, i, score };
  });
  const top = scored.sort((a, b) => b.score - a.score).slice(0, 5).sort((a, b) => a.i - b.i).map(({ s, t }) => ({ text: s, t_ms: t }));

  const last = all.length ? all[all.length - 1].t_ms : 0;
  const minutes = Math.max(last / 60000, 1);
  const speakers = {};
  for (const c of all) speakers[c.speaker] = (speakers[c.speaker] || 0) + words(c.text).length;
  return {
    keywords, highlights: top,
    stats: { captions: all.length, words: totalWords, durationMs: last, wordsPerMinute: Math.round(speech.reduce((n, c) => n + words(c.text).length, 0) / minutes), signCaptions: all.filter(c => c.source === 'sign').length, studentMessages: all.filter(c => c.source === 'student').length, speakers }
  };
}

const pad = (n, l = 2) => String(n).padStart(l, '0');
function ts(ms, sep) { ms = Math.floor(num(ms)); const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${pad(h)}:${pad(m)}:${pad(s)}${sep}${pad(ms % 1000, 3)}`; }
const label = (c) => (c.source === 'sign' ? `[Sign – ${c.speaker}] ` : c.source === 'student' ? `[${c.speaker}] ` : '');
const oneLine = (t) => String(t).replace(/\s*[\r\n]+\s*/g, ' ').trim();
function cues(captions) {
  const caps = valid(captions).map(c => ({ ...c, t_ms: num(c.t_ms), speaker: String(c.speaker ?? '') }));
  return caps.map((c, i) => {
    const next = caps[i + 1];
    const end = Math.min(next ? next.t_ms : c.t_ms + 4000, c.t_ms + 7000);
    return { start: c.t_ms, end: Math.max(end, c.t_ms + 1200), text: label(c) + oneLine(c.text) };
  });
}
const vttEscape = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/-->/g, '–>');
const toSRT = (caps) => cues(caps).map((c, i) => `${i + 1}\n${ts(c.start, ',')} --> ${ts(c.end, ',')}\n${c.text.replace(/-->/g, '–>')}\n`).join('\n');
const toVTT = (caps) => 'WEBVTT\n\n' + cues(caps).map(c => `${ts(c.start, '.')} --> ${ts(c.end, '.')}\n${vttEscape(c.text)}\n`).join('\n');
const toTXT = (caps, title = 'Transcript') => `${title}\n${'='.repeat(String(title).length)}\n\n` + valid(caps).map(c => `[${ts(c.t_ms, '.').slice(0, 8)}] ${c.source === 'sign' ? '(sign) ' : c.source === 'student' ? '(student) ' : ''}${c.speaker}: ${oneLine(c.text)}`).join('\n') + '\n';

/** Lecture text for the optional AI summary: teacher speech/typed captions only (student messages are excluded for privacy). */
function transcriptForAi(captions, maxChars) {
  const lines = valid(captions).filter(c => c.source === 'speech' || c.source === 'typed').map(c => `[${ts(c.t_ms, '.').slice(3, 8)}] ${oneLine(c.text)}`);
  let out = '', truncated = false;
  for (const l of lines) { if (out.length + l.length + 1 > maxChars) { truncated = true; break; } out += l + '\n'; }
  return { text: out, truncated, lines: lines.length };
}

module.exports = { applyVocab, summarize, toSRT, toVTT, toTXT, words, transcriptForAi, valid };
