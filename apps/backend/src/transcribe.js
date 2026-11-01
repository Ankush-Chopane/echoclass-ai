// Optional server-side speech recognition via an adapter. Disabled unless TRANSCRIPTION_PROVIDER is configured.
// Audio is held in memory only for the duration of the request and is never written to disk or logged.
class TranscribeError extends Error { constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; } }

const TYPES = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp4': 'mp4' };
function sniff(buf) {
  if (buf.length < 12) return null;
  const h = buf.subarray(0, 4).toString('hex');
  if (h === '1a45dfa3') return 'webm';
  if (buf.subarray(0, 4).toString('latin1') === 'OggS') return 'ogg';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WAVE') return 'wav';
  if (buf.subarray(0, 3).toString('latin1') === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'mp3';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp') return 'mp4';
  return null;
}
function validateAudio(buf, contentType, cfg, declaredMs) {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  if (!TYPES[ct]) throw new TranscribeError('unsupported_type', 'Unsupported audio type. Use webm, ogg, wav, mp3 or mp4.', 415);
  if (!Buffer.isBuffer(buf) || !buf.length) throw new TranscribeError('empty', 'No audio received.');
  if (buf.length > cfg.maxBytes) throw new TranscribeError('too_large', `Audio is larger than ${Math.round(cfg.maxBytes / 1024)} KB.`, 413);
  if (sniff(buf) !== TYPES[ct]) throw new TranscribeError('bad_audio', 'The file contents do not match the declared audio type.', 415);
  if (declaredMs != null && (!Number.isFinite(declaredMs) || declaredMs <= 0 || declaredMs > cfg.maxSeconds * 1000)) throw new TranscribeError('too_long', `Audio must be at most ${cfg.maxSeconds} seconds.`, 413);
  return { ext: TYPES[ct], type: ct };
}

function createTranscriber(cfg, fetchImpl = globalThis.fetch) {
  const enabled = cfg.provider !== 'none';
  return {
    enabled, provider: cfg.provider, validate: (buf, ct, ms) => validateAudio(buf, ct, cfg, ms),
    async transcribe(buf, contentType, { language, declaredMs } = {}) {
      if (!enabled) throw new TranscribeError('not_configured', 'Server-side transcription is not configured.', 501);
      const { ext, type } = validateAudio(buf, contentType, cfg, declaredMs);

      if (cfg.provider === 'vosk') {
        // Local, offline Vosk transcription of a short WAV clip. Needs: python + `pip install vosk` + the model (npm run fetch-speech-model).
        if (ext !== 'wav') throw new TranscribeError('unsupported_type', 'Offline (Vosk) transcription accepts 16-bit PCM WAV audio only.', 415);
        const { spawn } = require('child_process');
        const fs = require('fs'), path = require('path');
        const modelDir = cfg.modelPath || path.join(__dirname, '..', '..', '..', 'models', 'vosk');
        if (!fs.existsSync(modelDir)) throw new TranscribeError('model_missing', 'Offline Vosk model not found. Run npm run fetch-speech-model.', 503);
        // The model path is passed as an argument, never spliced into the program text.
        const program = [
          'import sys, json, io, wave',
          'from vosk import Model, KaldiRecognizer, SetLogLevel',
          'SetLogLevel(-1)',
          'try:',
          '    data = sys.stdin.buffer.read()',
          '    wf = wave.open(io.BytesIO(data), "rb")',
          '    rec = KaldiRecognizer(Model(sys.argv[1]), wf.getframerate())',
          '    rec.AcceptWaveform(wf.readframes(wf.getnframes()))',
          '    print(json.dumps({"text": json.loads(rec.FinalResult()).get("text", "")}))',
          'except Exception as e:',
          '    print(json.dumps({"error": str(e)}))',
        ].join('\n');
        return new Promise((resolve, reject) => {
          const p = spawn(cfg.pythonPath || (process.platform === 'win32' ? 'python' : 'python3'), ['-c', program, modelDir]);
          let out = '', err = '', done = false;
          const finish = (fn, v) => { if (!done) { done = true; clearTimeout(timer); fn(v); } };
          const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* gone */ } finish(reject, new TranscribeError('timeout', 'Offline transcription timed out.', 504)); }, cfg.timeoutMs || 20000);
          p.stdout.on('data', d => (out += d.toString()));
          p.stderr.on('data', d => (err += d.toString()));
          p.on('error', e => finish(reject, new TranscribeError('provider_error', 'Could not start Python for offline transcription (' + e.code + '). Install Python 3 and `pip install vosk`, or set PYTHON_PATH.', 502)));
          p.on('close', code => {
            if (code !== 0) return finish(reject, new TranscribeError('provider_error', 'Offline transcription process failed. Is `pip install vosk` done? ' + err.slice(-200), 502));
            try {
              const res = JSON.parse(out.trim());
              if (res.error) return finish(reject, new TranscribeError('provider_error', res.error, 502));
              finish(resolve, { text: typeof res.text === 'string' ? res.text.replace(/\s+/g, ' ').trim().slice(0, 600) : '' });
            } catch { finish(reject, new TranscribeError('invalid_output', 'Could not parse Vosk output', 502)); }
          });
          p.stdin.on('error', () => { /* process exited early; handled by close */ });
          p.stdin.end(buf);
        });
      }

      const form = new FormData();
      form.append('file', new Blob([buf], { type }), `audio.${ext}`); form.append('model', cfg.model);
      if (language && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(language)) form.append('language', language.split('-')[0]);
      let res;
      try { res = await fetchImpl(cfg.baseUrl + '/audio/transcriptions', { method: 'POST', headers: { authorization: 'Bearer ' + cfg.apiKey }, body: form, signal: AbortSignal.timeout(cfg.timeoutMs) }); }
      catch (e) { throw new TranscribeError(e.name === 'TimeoutError' || e.name === 'AbortError' ? 'timeout' : 'unreachable', 'The transcription service did not respond.', 504); }
      if (res.status === 401 || res.status === 403) throw new TranscribeError('provider_auth', 'The transcription provider rejected the configured credentials.', 502);
      if (!res.ok) throw new TranscribeError('provider_error', `The transcription provider returned an error (HTTP ${res.status}).`, 502);
      let body; try { body = await res.json(); } catch { throw new TranscribeError('invalid_output', 'Unreadable transcription response.', 502); }
      const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim().slice(0, 600) : '';
      return { text };
    },
  };
}
module.exports = { createTranscriber, validateAudio, sniff, TranscribeError };
