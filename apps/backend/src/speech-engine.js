// Offline Speech Recognition Engine manager using local Vosk worker.
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const log = require('./log');

class SpeechEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    this.modelPath = path.resolve(options.modelPath || path.join(__dirname, '..', '..', '..', 'models', 'vosk'));
    this.workerScript = path.resolve(options.workerScript || path.join(__dirname, '..', 'scripts', 'vosk_worker.py'));
    this.pythonPath = options.pythonPath || (process.platform === 'win32' ? 'python' : 'python3');
    this.retryAfter = 0;          // after a failed start, do not respawn until this time (prevents a spawn storm)
    this.sampleRate = options.sampleRate || 16000;
    this.worker = null;
    this.ready = false;
    this.starting = false;
    this.activeSessionId = null;
    this.lastInterim = '';
    this.lastFinal = { text: '', at: 0 };
    this.errorMsg = null;
    this.bufferQueue = [];
    this.maxQueueSize = 50; // Max ~5-10 seconds buffer under heavy backpressure
  }

  isModelInstalled() {
    return fs.existsSync(path.join(this.modelPath, 'am', 'final.mdl')) ||
           fs.existsSync(path.join(this.modelPath, 'conf', 'model.conf'));
  }

  getStatus() {
    const installed = this.isModelInstalled();
    return {
      available: installed,
      provider: 'vosk',
      ready: this.ready,
      modelPath: this.modelPath,
      sampleRate: this.sampleRate,
      error: installed ? (this.errorMsg || null) : 'Offline Vosk model not found. Run: npm run fetch-speech-model'
    };
  }

  /** Safe to send to browsers: no server paths. */
  publicStatus() {
    const s = this.getStatus();
    return { available: s.available, ready: s.ready, provider: 'vosk', sampleRate: s.sampleRate, error: s.error ? (s.available ? 'The offline speech worker reported a problem. Check the server log.' : s.error) : null };
  }

  startWorker() {
    if (this.worker || this.starting) return;
    if (Date.now() < this.retryAfter) return;
    if (!this.isModelInstalled()) {
      this.errorMsg = 'Offline Vosk model directory not found at: ' + this.modelPath;
      log.warn('offline speech engine model not installed', { path: this.modelPath });
      return;
    }

    this.starting = true;
    this.errorMsg = null;

    try {
      this.worker = spawn(this.pythonPath, [this.workerScript, '--model', this.modelPath, '--sample-rate', String(this.sampleRate)]);
    } catch (err) {
      this.starting = false;
      this.ready = false;
      this.errorMsg = 'Failed to spawn python vosk worker: ' + err.message;
      log.error('speech worker spawn failed', { err: err.message });
      return;
    }

    // A write to a worker that has exited (EPIPE / write-after-end) emits 'error' on stdin; unhandled, that would crash the whole server.
    this.worker.stdin.on('error', (e) => log.warn('speech worker stdin error', { err: e.code || e.message }));
    this.worker.stdout.on('error', () => {}); this.worker.stderr.on('error', () => {});
    let buffer = '';
    this.worker.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop(); // Keep incomplete tail

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.ready) {
            this.ready = true;
            this.starting = false;
            log.info('offline vosk worker ready', { model: msg.model });
            this.emit('ready', msg);
            this.flushQueue();
          } else if (msg.error) {
            this.errorMsg = msg.error;
            log.warn('offline vosk worker reported error', { err: msg.error });
            this.retryAfter = Date.now() + 30_000;
            this.emit('worker-error', msg.error);
          } else if (msg.type === 'interim') {
            this.lastInterim = msg.text;
            this.emit('interim', msg.text);
          } else if (msg.type === 'final') {
            const now = Date.now();
            // Deduplicate if identical within 1500ms
            if (msg.text !== this.lastFinal.text || now - this.lastFinal.at > 1500) {
              this.lastFinal = { text: msg.text, at: now };
              this.lastInterim = '';
              this.emit('final', msg.text);
            }
          }
        } catch {
          // ignore non-json log lines
        }
      }
    });

    this.worker.stderr.on('data', (data) => {
      const errStr = data.toString().trim();
      if (errStr && !errStr.startsWith('LOG (VoskAPI')) {
        log.warn('speech worker stderr', { text: errStr });
      }
    });

    this.worker.on('exit', (code, sig) => {
      this.ready = false;
      this.starting = false;
      this.worker = null;
      log.info('speech worker exited', { code, sig });
      if (code) this.retryAfter = Date.now() + 30_000;
      this.emit('exit', { code, sig });
    });

    this.worker.on('error', (err) => {
      this.ready = false;
      this.starting = false;
      this.worker = null;
      this.errorMsg = err.message;
      this.retryAfter = Date.now() + 30_000;
      log.error('speech worker process error', { err: err.message });
      this.emit('worker-error', err.message);
    });
  }

  feedAudio(base64Data) {
    if (!this.ready) {
      if (!this.worker && !this.starting) this.startWorker();
      if (this.bufferQueue.length < this.maxQueueSize) {
        this.bufferQueue.push(base64Data);
      }
      return false;
    }
    try {
      this.worker.stdin.write(JSON.stringify({ action: 'audio', data: base64Data }) + '\n');
      return true;
    } catch (e) {
      log.warn('speech worker stdin write failed', { err: e.message });
      return false;
    }
  }

  flushQueue() {
    if (!this.ready || !this.worker) return;
    while (this.bufferQueue.length > 0) {
      const chunk = this.bufferQueue.shift();
      try {
        this.worker.stdin.write(JSON.stringify({ action: 'audio', data: chunk }) + '\n');
      } catch {
        break;
      }
    }
  }

  flush() {
    if (this.ready && this.worker) {
      try {
        this.worker.stdin.write(JSON.stringify({ action: 'flush' }) + '\n');
      } catch { /* ignore */ }
    }
  }

  reset() {
    this.bufferQueue = [];
    this.lastInterim = '';
    if (this.ready && this.worker) {
      try {
        this.worker.stdin.write(JSON.stringify({ action: 'reset' }) + '\n');
      } catch { /* ignore */ }
    }
  }

  close() {
    this.bufferQueue = [];
    if (this.closing) return;
    if (this.worker) {
      this.closing = true;
      try {
        this.worker.stdin.write(JSON.stringify({ action: 'flush' }) + '\n');
        this.worker.stdin.end();
      } catch { /* ignore */ }
      setTimeout(() => {
        if (this.worker) {
          try { this.worker.kill('SIGTERM'); } catch { /* ignore */ }
        }
      }, 500).unref?.();
    }
    this.ready = false;
  }
}

function createSpeechEngine(options) {
  const engine = new SpeechEngine(options);
  if (engine.isModelInstalled()) {
    engine.startWorker();
  }
  return engine;
}

module.exports = { createSpeechEngine, SpeechEngine };
