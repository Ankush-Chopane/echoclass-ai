#!/usr/bin/env node
// scripts/dev.js — Starts backend + frontend together without cmd.exe shims
// Works even when the project path contains spaces or & characters.
'use strict';
const { spawn } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NODE = process.execPath; // full path to node.exe — no shim needed

const CYAN    = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const RESET   = '\x1b[0m';

function run(name, color, args, cwd) {
  const p = spawn(NODE, args, { cwd, shell: false });

  function print(stream, out) {
    stream.on('data', chunk =>
      chunk.toString().split(/\r?\n/).forEach(line => {
        if (line) out(`${color}[${name}]${RESET} ${line}`);
      })
    );
  }
  print(p.stdout, console.log);
  print(p.stderr, console.error);

  p.on('exit', code => {
    console.log(`${color}[${name}]${RESET} process exited (code ${code})`);
    process.exit(code ?? 0);
  });
  return p;
}

console.log(`${CYAN}[backend]${RESET}  → http://localhost:3000`);
console.log(`${MAGENTA}[frontend]${RESET} → http://localhost:5173`);
console.log('');

// Backend: node --watch backend/src/server.js
run('backend', CYAN,
  ['--watch', path.join(ROOT, 'backend', 'src', 'server.js')],
  ROOT
);

// Frontend: node node_modules/vite/bin/vite.js  (from frontend/ dir so vite finds its config)
run('frontend', MAGENTA,
  [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')],
  path.join(ROOT, 'frontend')
);

process.on('SIGINT', () => {
  console.log('\nStopping...');
  process.exit(0);
});
