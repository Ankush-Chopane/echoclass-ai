#!/usr/bin/env node
/**
 * EchoClass AI – Pre-flight Validation for Offline Classroom Mode.
 * Validates dependencies, models, database paths, and reports network addresses.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

console.log('\n===============================================================');
console.log('       EchoClass AI – Offline Classroom Pre-flight Check');
console.log('===============================================================\n');

let allGood = true;

// 1. Node.js check
const nodeVer = process.version;
const major = parseInt(nodeVer.replace('v', '').split('.')[0], 10);
if (major >= 20) {
  console.log(`[OK] Node.js version: ${nodeVer}`);
} else {
  console.log(`[WARN] Node.js version ${nodeVer} detected (>= v20 recommended)`);
}

// 2. Database path check
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'database', 'echoclass.db');
const dbDir = path.dirname(path.resolve(dbPath));
try {
  fs.mkdirSync(dbDir, { recursive: true });
  fs.accessSync(dbDir, fs.constants.W_OK);
  console.log(`[OK] SQLite database storage writable: ${dbDir}`);
} catch (e) {
  console.log(`[FAIL] SQLite database storage is not writable at ${dbDir}: ${e.message}`);
  allGood = false;
}

// 3. MediaPipe Hand Gesture Model check
const handModel = path.join(__dirname, '..', '..', 'frontend', 'public', 'models', 'hand_landmarker.task');
if (fs.existsSync(handModel) && fs.statSync(handModel).size > 1e6) {
  console.log(`[OK] MediaPipe hand landmark model present (${(fs.statSync(handModel).size / 1024 / 1024).toFixed(1)} MB)`);
} else {
  console.log(`[WARN] MediaPipe hand model not found at public/models/hand_landmarker.task.`);
  console.log(`       Run: npm run fetch-model`);
}

// 4. Offline Speech Recognition (Vosk) model check
const voskDir = path.resolve(process.env.VOSK_MODEL_PATH || path.join(__dirname, '..', '..', 'models', 'vosk'));
const hasVoskModel = fs.existsSync(path.join(voskDir, 'am', 'final.mdl')) || fs.existsSync(path.join(voskDir, 'conf', 'model.conf'));
if (hasVoskModel) {
  console.log(`[OK] Offline Vosk speech model present: ${voskDir}`);
} else {
  console.log(`[WARN] Offline Vosk speech model not found at ${voskDir}`);
  console.log(`       Run: npm run fetch-speech-model`);
}

// 5. Python & Vosk package check
try {
  const py = spawnSync(process.env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3'), ['-c', 'import vosk; print("vosk-ok")'], { encoding: 'utf-8' });
  if (py.status === 0 && py.stdout.includes('vosk-ok')) {
    console.log(`[OK] Python 3 + Vosk engine available.`);
  } else {
    console.log(`[INFO] Python 'vosk' package not detected in current environment.`);
    console.log(`       To enable local streaming speech recognition, run: pip install vosk`);
  }
} catch {
  console.log(`[INFO] Python not found on PATH. Browser Web Speech API fallback will be available.`);
}

// 6. Network interfaces
console.log('\n--- Classroom Network Connectivity ---');
const ifaces = os.networkInterfaces();
const localIps = [];
for (const [name, list] of Object.entries(ifaces)) {
  for (const net of list || []) {
    if (net.family === 'IPv4' && !net.internal) {
      localIps.push({ iface: name, ip: net.address });
    }
  }
}

const port = process.env.PORT || 3000;
console.log(` Teacher access (this machine): http://localhost:${port}`);
if (localIps.length) {
  console.log(` Student Wi-Fi access URLs:`);
  localIps.forEach(item => {
    console.log(`   -> http://${item.ip}:${port}  [Interface: ${item.iface}]`);
  });
} else {
  console.log(` [NOTE] No active Wi-Fi / Ethernet IPv4 network detected. Connect to Wi-Fi to allow student devices to join.`);
}

console.log('\n===============================================================\n');

if (!allGood) {
  process.exit(1);
}