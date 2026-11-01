// Best-effort download of the MediaPipe hand model so it can be self-hosted.
// If it fails the browser falls back to Google's CDN, so this never breaks install.
const fs = require('fs'), path = require('path');
const URL_ = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const out = path.join(__dirname, '..', '..', 'classroom-web', 'public', 'models', 'hand_landmarker.task');
(async () => {
  if (fs.existsSync(out) && fs.statSync(out).size > 1e6) return;
  try {
    const r = await fetch(URL_, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
    console.log('hand model saved to', out);
  } catch (e) { console.log('[fetch-model] skipped (' + e.message + '); browser will use CDN fallback.'); }
})();
