#!/usr/bin/env node
/**
 * Trains a Multi-Layer Perceptron (MLP) Neural Network on 21-point 3D hand landmarks
 * for the 12 EchoClass classroom gestures + a NONE (negative/unsupported) class.
 *
 * Usage:
 *   node backend/scripts/train-gestures.js [--data path/to/samples.jsonl] [--epochs 80]
 *
 * Outputs:
 *   shared/gesture-model.json  (trained weights, scaler stats, class labels, validation metrics)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_PATH = path.join(ROOT, 'shared', 'gesture-model.json');

const CLASSES = [
  'HELLO', 'FIST', 'THUMBS_UP', 'THUMBS_DOWN', 'POINT', 'PEACE',
  'THREE', 'FOUR', 'L', 'OK', 'HELP', 'ILY', 'NONE'
];

// --- Feature extraction (must stay identical in shared/gestures.js) ---
const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

function extractFeatures(lm) {
  const wrist = lm[0];
  const palm = dist3(wrist, lm[9]) || 1e-6;
  const feats = [];

  // 21 * 3 = 63 wrist-centered, palm-scale-normalized coordinates
  for (let i = 0; i < 21; i++) {
    feats.push((lm[i].x - wrist.x) / palm);
    feats.push((lm[i].y - wrist.y) / palm);
    feats.push(((lm[i].z || 0) - (wrist.z || 0)) / palm);
  }

  // 4 finger extension ratios (tip-to-wrist / mcp-to-wrist)
  const fingers = [[5, 8], [9, 12], [13, 16], [17, 20]];
  for (const [mcp, tip] of fingers) {
    feats.push(dist3(lm[tip], wrist) / (dist3(lm[mcp], wrist) || 1e-6));
  }

  // Thumb extension, verticality, pinch, spread (4 features)
  feats.push(dist3(lm[4], lm[5]) / palm);
  feats.push((lm[4].y - wrist.y) / palm);
  feats.push(dist3(lm[4], lm[8]) / palm);
  feats.push(dist3(lm[8], lm[20]) / palm);

  // Adjacent fingertip distances + thumb-to-pinky-MCP tuck features (6 features) -> total 77 features
  feats.push(dist3(lm[4], lm[8]) / palm);
  feats.push(dist3(lm[8], lm[12]) / palm);
  feats.push(dist3(lm[12], lm[16]) / palm);
  feats.push(dist3(lm[16], lm[20]) / palm);
  feats.push(dist3(lm[4], lm[17]) / palm);
  feats.push(dist3(lm[3], lm[17]) / palm);

  return feats;
}

// --- Deterministic PRNG for reproducible training ---
function makeRng(seed = 42) {
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const randn = () => {
    const u = Math.max(1e-7, rand()), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return { rand, randn, uniform: (a, b) => a + (b - a) * rand() };
}

// --- Realistic 3D hand pose synthesizer with curl, tilt, mirror & noise ---
function synthHand(rng, ext, { thumbDir = 'side', pinchIndex = false } = {}) {
  const lm = Array(21);
  const mirror = rng.rand() < 0.5 ? -1 : 1;
  const spreadScale = rng.uniform(0.85, 1.15);
  const cx = 0.5, cy = 0.78;
  lm[0] = { x: cx, y: cy, z: 0 };

  const xs = { index: -0.065, middle: 0.0, ring: 0.06, pinky: 0.12 };
  const mcpY = { index: -0.18, middle: -0.20, ring: -0.18, pinky: -0.14 };
  const joints = { index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], pinky: [17, 18, 19, 20] };

  for (const k of Object.keys(joints)) {
    const [m, p, dI, t] = joints[k];
    const x = cx + mirror * xs[k] * spreadScale;
    const y = cy + mcpY[k];
    lm[m] = { x, y, z: rng.randn() * 0.005 };
    const splay = mirror * (xs[k] * rng.uniform(0.1, 0.4));
    if (ext[k]) {
      const len = rng.uniform(0.85, 1.15);
      lm[p] = { x: x + splay * 0.3, y: y - 0.07 * len, z: rng.randn() * 0.008 };
      lm[dI] = { x: x + splay * 0.6, y: y - 0.13 * len, z: rng.randn() * 0.01 };
      lm[t] = { x: x + splay, y: y - 0.19 * len, z: rng.randn() * 0.012 };
    } else {
      const curl = rng.uniform(0.8, 1.2);
      lm[p] = { x, y: y - 0.045 * curl, z: -0.025 };
      lm[dI] = { x, y: y + 0.005 * curl, z: -0.04 };
      lm[t] = { x, y: y + 0.045 * curl, z: -0.03 };
    }
  }

  lm[1] = { x: cx - mirror * 0.05, y: cy - 0.04, z: -0.01 };
  lm[2] = { x: cx - mirror * 0.09, y: cy - 0.08, z: -0.015 };
  if (ext.thumb) {
    if (thumbDir === 'up') {
      lm[3] = { x: cx - mirror * 0.10, y: cy - 0.20, z: 0 };
      lm[4] = { x: cx - mirror * 0.11, y: cy - rng.uniform(0.30, 0.38), z: 0 };
    } else if (thumbDir === 'down') {
      lm[3] = { x: cx - mirror * 0.10, y: cy + 0.07, z: 0 };
      lm[4] = { x: cx - mirror * 0.11, y: cy + rng.uniform(0.16, 0.24), z: 0 };
    } else {
      lm[3] = { x: cx - mirror * 0.16, y: cy - 0.11, z: 0 };
      lm[4] = { x: cx - mirror * rng.uniform(0.22, 0.27), y: cy - 0.15, z: 0 };
    }
  } else {
    const tuck = rng.uniform(-0.04, 0.03);
    const flatZ = rng.rand() < 0.25 ? 0 : 1; // include flat-z camera/synthetic frames
    lm[3] = { x: cx - mirror * 0.045, y: cy - 0.12, z: -0.02 * flatZ };
    lm[4] = { x: cx + mirror * tuck, y: cy - rng.uniform(0.14, 0.17), z: -0.03 * flatZ };
  }

  if (pinchIndex) {
    const px = cx - mirror * 0.04, py = cy - 0.18;
    lm[4] = { x: px, y: py, z: -0.02 };
    lm[8] = { x: px + rng.randn() * 0.006, y: py + rng.randn() * 0.006, z: -0.02 };
    lm[7] = { x: px + mirror * 0.02, y: py - 0.02, z: -0.015 };
    lm[6] = { x: cx + mirror * xs.index, y: cy - 0.22, z: -0.01 };
  }

  // Apply 2D in-plane rotation (restricted for THUMBS_UP/THUMBS_DOWN)
  const maxAngle = (thumbDir === 'up' || thumbDir === 'down') ? 0.35 : 0.65;
  const ang = rng.uniform(-maxAngle, maxAngle);
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const scale = rng.uniform(0.65, 1.45);
  const tx = rng.uniform(-0.2, 0.2), ty = rng.uniform(-0.2, 0.2);

  return lm.map((pt) => {
    const dx = (pt.x - cx) * scale;
    const dy = (pt.y - cy) * scale;
    return {
      x: cx + tx + dx * cos - dy * sin + rng.randn() * 0.004,
      y: cy + ty + dx * sin + dy * cos + rng.randn() * 0.004,
      z: (pt.z || 0) * scale + rng.randn() * 0.004,
    };
  });
}

function generateDataset(rng, perClass = 300) {
  const specs = {
    HELLO:       [{ thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1 }, {}],
    FIST:        [{}, {}],
    THUMBS_UP:   [{ thumb: 1 }, { thumbDir: 'up' }],
    THUMBS_DOWN: [{ thumb: 1 }, { thumbDir: 'down' }],
    POINT:       [{ index: 1 }, {}],
    PEACE:       [{ index: 1, middle: 1 }, {}],
    THREE:       [{ index: 1, middle: 1, ring: 1 }, {}],
    FOUR:        [{ index: 1, middle: 1, ring: 1, pinky: 1 }, {}],
    L:           [{ thumb: 1, index: 1 }, {}],
    OK:          [{ middle: 1, ring: 1, pinky: 1 }, { pinchIndex: true }],
    HELP:        [{ thumb: 1, pinky: 1 }, {}],
    ILY:         [{ thumb: 1, index: 1, pinky: 1 }, {}],
  };

  const noneConfigs = [
    { middle: 1 }, { ring: 1 }, { pinky: 1 },
    { index: 1, ring: 1 }, { middle: 1, ring: 1 }, { middle: 1, pinky: 1 },
    { ring: 1, pinky: 1 }, { thumb: 1, middle: 1 }, { thumb: 1, ring: 1 },
    { thumb: 1, middle: 1, ring: 1 }, { index: 1, middle: 1, pinky: 1 },
    { thumb: 1, index: 1, middle: 1, ring: 1 },
  ];

  const samples = [];
  for (const [label, [ext, opts]] of Object.entries(specs)) {
    for (let i = 0; i < perClass; i++) {
      samples.push({ x: extractFeatures(synthHand(rng, ext, opts)), y: CLASSES.indexOf(label) });
    }
  }
  const noneIdx = CLASSES.indexOf('NONE');
  for (let i = 0; i < perClass; i++) {
    const ext = noneConfigs[i % noneConfigs.length];
    samples.push({ x: extractFeatures(synthHand(rng, ext, {})), y: noneIdx });
  }
  return samples;
}

// --- Pure-JS MLP Neural Network (75 -> 64 -> 32 -> 13) with Adam ---
function createMLP(inDim, h1, h2, outDim, rng) {
  const initLayer = (rows, cols) => {
    const scale = Math.sqrt(2 / rows);
    const W = Array.from({ length: rows }, () => Array.from({ length: cols }, () => rng.randn() * scale));
    const b = Array(cols).fill(0);
    return { W, b, mW: W.map(r => r.map(() => 0)), vW: W.map(r => r.map(() => 0)), mb: b.map(() => 0), vb: b.map(() => 0) };
  };
  return [initLayer(inDim, h1), initLayer(h1, h2), initLayer(h2, outDim)];
}

function forward(layers, x) {
  const acts = [x];
  let cur = x;
  for (let l = 0; l < layers.length; l++) {
    const { W, b } = layers[l];
    const outDim = b.length;
    const z = new Array(outDim);
    for (let j = 0; j < outDim; j++) {
      let sum = b[j];
      for (let i = 0; i < cur.length; i++) sum += cur[i] * W[i][j];
      z[j] = l < layers.length - 1 ? (sum > 0 ? sum : 0) : sum; // ReLU on hidden, linear on output
    }
    if (l === layers.length - 1) {
      const maxZ = Math.max(...z);
      const exps = z.map(v => Math.exp(v - maxZ));
      const sumE = exps.reduce((a, b) => a + b, 0);
      cur = exps.map(e => e / sumE);
    } else {
      cur = z;
    }
    acts.push(cur);
  }
  return acts;
}

function trainMLP(trainData, valData, { epochs = 60, batchSize = 32, lr = 0.003 } = {}) {
  const rng = makeRng(2026);
  const inDim = trainData[0].x.length;
  const layers = createMLP(inDim, 64, 32, CLASSES.length, rng);
  let step = 0;
  const beta1 = 0.9, beta2 = 0.999, eps = 1e-8;

  for (let ep = 1; ep <= epochs; ep++) {
    // Shuffle
    for (let i = trainData.length - 1; i > 0; i--) {
      const j = Math.floor(rng.rand() * (i + 1));
      [trainData[i], trainData[j]] = [trainData[j], trainData[i]];
    }

    let lossSum = 0;
    for (let start = 0; start < trainData.length; start += batchSize) {
      const batch = trainData.slice(start, start + batchSize);
      const grads = layers.map(L => ({
        dW: L.W.map(r => r.map(() => 0)),
        db: L.b.map(() => 0),
      }));

      for (const sample of batch) {
        const acts = forward(layers, sample.x);
        const probs = acts[acts.length - 1];
        lossSum -= Math.log(Math.max(probs[sample.y], 1e-9));

        // Cross-entropy + softmax gradient
        let delta = probs.slice();
        delta[sample.y] -= 1;

        for (let l = layers.length - 1; l >= 0; l--) {
          const prevAct = acts[l];
          const L = layers[l];
          const g = grads[l];
          for (let j = 0; j < delta.length; j++) {
            g.db[j] += delta[j];
            for (let i = 0; i < prevAct.length; i++) {
              g.dW[i][j] += prevAct[i] * delta[j];
            }
          }
          if (l > 0) {
            const nextDelta = new Array(prevAct.length).fill(0);
            for (let i = 0; i < prevAct.length; i++) {
              if (prevAct[i] <= 0) continue; // ReLU derivative
              let s = 0;
              for (let j = 0; j < delta.length; j++) s += delta[j] * L.W[i][j];
              nextDelta[i] = s;
            }
            delta = nextDelta;
          }
        }
      }

      // Adam update
      step++;
      const invB = 1 / batch.length;
      const b1c = 1 - Math.pow(beta1, step);
      const b2c = 1 - Math.pow(beta2, step);
      for (let l = 0; l < layers.length; l++) {
        const L = layers[l], g = grads[l];
        for (let j = 0; j < L.b.length; j++) {
          const gb = g.db[j] * invB;
          L.mb[j] = beta1 * L.mb[j] + (1 - beta1) * gb;
          L.vb[j] = beta2 * L.vb[j] + (1 - beta2) * gb * gb;
          L.b[j] -= lr * (L.mb[j] / b1c) / (Math.sqrt(L.vb[j] / b2c) + eps);
          for (let i = 0; i < L.W.length; i++) {
            const gw = g.dW[i][j] * invB + 1e-4 * L.W[i][j]; // L2 regularization
            L.mW[i][j] = beta1 * L.mW[i][j] + (1 - beta1) * gw;
            L.vW[i][j] = beta2 * L.vW[i][j] + (1 - beta2) * gw * gw;
            L.W[i][j] -= lr * (L.mW[i][j] / b1c) / (Math.sqrt(L.vW[i][j] / b2c) + eps);
          }
        }
      }
    }

    if (ep === 1 || ep % 15 === 0 || ep === epochs) {
      const valAcc = accuracy(layers, valData);
      console.log(`Epoch ${String(ep).padStart(2)}/${epochs} | loss: ${(lossSum / trainData.length).toFixed(4)} | val_acc: ${(valAcc * 100).toFixed(2)}%`);
    }
  }
  return layers;
}

function accuracy(layers, data) {
  let ok = 0;
  for (const s of data) {
    const probs = forward(layers, s.x).pop();
    let best = 0;
    for (let i = 1; i < probs.length; i++) if (probs[i] > probs[best]) best = i;
    if (best === s.y) ok++;
  }
  return ok / data.length;
}

function main() {
  const args = process.argv.slice(2);
  const dataIdx = args.indexOf('--data');
  const epIdx = args.indexOf('--epochs');
  const epochs = epIdx >= 0 ? Number(args[epIdx + 1]) || 60 : 60;

  const rng = makeRng(1337);
  let samples = generateDataset(rng, 320);

  if (dataIdx >= 0 && args[dataIdx + 1]) {
    const file = args[dataIdx + 1];
    const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
    let added = 0;
    for (const line of lines) {
      const row = JSON.parse(line);
      const y = CLASSES.indexOf(row.label);
      if (y >= 0 && Array.isArray(row.landmarks) && row.landmarks.length >= 21) {
        samples.push({ x: extractFeatures(row.landmarks), y });
        added++;
      }
    }
    console.log(`Loaded ${added} real samples from ${file}`);
  }

  // Shuffle & 80/20 split
  for (let i = samples.length - 1; i > 0; i--) {
    const j = Math.floor(rng.rand() * (i + 1));
    [samples[i], samples[j]] = [samples[j], samples[i]];
  }
  const split = Math.floor(samples.length * 0.8);
  const trainRaw = samples.slice(0, split);
  const valRaw = samples.slice(split);

  // Z-score standardization fitted on training split only
  const dim = trainRaw[0].x.length;
  const mean = Array(dim).fill(0);
  const std = Array(dim).fill(0);
  for (const s of trainRaw) for (let i = 0; i < dim; i++) mean[i] += s.x[i];
  for (let i = 0; i < dim; i++) mean[i] /= trainRaw.length;
  for (const s of trainRaw) for (let i = 0; i < dim; i++) std[i] += (s.x[i] - mean[i]) ** 2;
  for (let i = 0; i < dim; i++) std[i] = Math.sqrt(std[i] / trainRaw.length) || 1;

  const norm = (arr) => arr.map(s => ({ x: s.x.map((v, i) => (v - mean[i]) / std[i]), y: s.y }));
  const trainData = norm(trainRaw);
  const valData = norm(valRaw);

  console.log(`Training MLP (75 -> 64 -> 32 -> 13) on ${trainData.length} samples, validating on ${valData.length}...`);
  const layers = trainMLP(trainData, valData, { epochs });
  const valAcc = accuracy(layers, valData);

  // Round weights to 5 decimals to keep JSON compact (~180KB)
  const roundMat = (m) => m.map(r => r.map(v => Math.round(v * 1e5) / 1e5));
  const roundVec = (v) => v.map(x => Math.round(x * 1e5) / 1e5);

  const model = {
    version: 1,
    architecture: 'MLP(75->64->32->13, ReLU, Softmax)',
    trainedAt: new Date().toISOString(),
    classes: CLASSES,
    featureDim: dim,
    validationAccuracy: Math.round(valAcc * 10000) / 10000,
    scaler: { mean: roundVec(mean), std: roundVec(std) },
    layers: layers.map(L => ({ W: roundMat(L.W), b: roundVec(L.b) })),
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(model));
  const jsOutPath = path.join(ROOT, 'shared', 'gesture-model.js');
  fs.writeFileSync(jsOutPath, `// Auto-generated by backend/scripts/train-gestures.js\nexport default ${JSON.stringify(model)};\n`);
  console.log(`Saved trained model to ${OUT_PATH} and ${jsOutPath} (${(fs.statSync(OUT_PATH).size / 1024).toFixed(1)} KB, val_acc=${(valAcc * 100).toFixed(2)}%)`);
}

main();
