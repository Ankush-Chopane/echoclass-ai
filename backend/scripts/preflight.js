#!/usr/bin/env node
/**
 * EchoClass AI pre-flight validation.
 * Checks required dependencies, model files, database paths, and network addresses.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

console.log('\n===============================================================');
console.log('          EchoClass AI – Pre-flight Check');
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

// 4. Network interfaces
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