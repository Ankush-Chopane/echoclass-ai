// Download and extract offline Vosk speech recognition model
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const MODEL_DIR = path.join(__dirname, '..', '..', '..', 'models', 'vosk');
const ZIP_PATH = path.join(__dirname, '..', '..', '..', 'models', 'vosk-model.zip');
const EXTRACT_SCRIPT = path.join(__dirname, 'extract-vosk.py');
const MODEL_URL = process.env.VOSK_MODEL_URL || 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip';

(async () => {
  if (fs.existsSync(path.join(MODEL_DIR, 'am', 'final.mdl')) || fs.existsSync(path.join(MODEL_DIR, 'conf', 'model.conf'))) {
    console.log('[fetch-speech-model] Offline Vosk model is already installed at:', MODEL_DIR);
    return;
  }

  console.log(`[fetch-speech-model] Downloading offline speech recognition model (~41MB)...`);
  console.log(`URL: ${MODEL_URL}`);
  fs.mkdirSync(path.dirname(MODEL_DIR), { recursive: true });

  try {
    const res = await fetch(MODEL_URL, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(ZIP_PATH, buffer);
    console.log(`[fetch-speech-model] Downloaded ${Math.round(buffer.length / 1024 / 1024)} MB. Extracting...`);

    const result = spawnSync(process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3'), [EXTRACT_SCRIPT], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Extraction failed with exit code ${result.status}`);

    console.log('[fetch-speech-model] Successfully installed offline speech model to:', MODEL_DIR);
  } catch (err) {
    console.error('[fetch-speech-model] Error downloading model:', err.message);
    console.log('You can manually download the model from https://alphacephei.com/vosk/models and extract it into models/vosk');
  }
})();
