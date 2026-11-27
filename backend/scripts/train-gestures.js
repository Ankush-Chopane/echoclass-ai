#!/usr/bin/env node
/**
 * Trains an MLP on real, labelled 21-point hand landmarks for the registered classroom cues.
 * Validation is split by signer; synthetic landmarks are never included in training or validation.
 *
 * Usage:
 *   node backend/scripts/train-gestures.js --data path/to/samples.jsonl [--epochs 80]
 *
 * Outputs:
 *   shared/gesture-model.json  (trained weights, scaler stats, class labels, validation metrics)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const G = require('@echoclass/shared/gestures').default;

const ROOT = path.resolve(__dirname, '..', '..');
const OUT_PATH = path.join(ROOT, 'shared', 'gesture-model.json');

const CLASSES = [...Object.keys(G.DEFAULTS), 'NONE'];

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
  return { rand, randn };
}

function loadSamples(file) {
  const rows = [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    let row;
    try { row = JSON.parse(lines[i]); }
    catch { throw new Error(`Line ${i + 1} is not valid JSON`); }

    if (!row || typeof row !== 'object' || Array.isArray(row) || !CLASSES.includes(row.label)) {
      throw new Error(`Line ${i + 1} has an unsupported label; expected one of: ${CLASSES.join(', ')}`);
    }
    if (typeof row.person !== 'string' || !row.person.trim()) {
      throw new Error(`Line ${i + 1} must include a non-empty person identifier for signer-independent validation`);
    }
    if (!Array.isArray(row.landmarks) || row.landmarks.length !== 21 || row.landmarks.some((p) =>
      !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || (p.z != null && !Number.isFinite(p.z)))) {
      throw new Error(`Line ${i + 1} must contain exactly 21 finite hand landmarks`);
    }
    const landmarks = row.landmarks.map((p) => ({ x: p.x, y: p.y, z: p.z || 0 }));
    rows.push({ x: extractFeatures(landmarks), label: row.label, person: row.person.trim() });
  }

  if (!rows.length) throw new Error('No samples found.');
  const present = new Set(rows.map((row) => row.label));
  if (!present.has('NONE')) throw new Error('Training data must include NONE examples of unsupported or ordinary movement.');
  const classes = CLASSES.filter((label) => present.has(label));
  if (classes.length < 2) throw new Error('Training data must include at least one registered cue plus NONE.');
  const classIndex = new Map(classes.map((label, index) => [label, index]));
  return {
    classes,
    samples: rows.map(({ x, label, person }) => ({ x, y: classIndex.get(label), person }))
  };
}

function splitByPerson(samples, classes, rng = makeRng(1337)) {
  const byPerson = new Map();
  for (const sample of samples) {
    if (!byPerson.has(sample.person)) byPerson.set(sample.person, []);
    byPerson.get(sample.person).push(sample);
  }
  const people = [...byPerson.keys()];
  if (people.length < 2) throw new Error('At least two different people are required for signer-independent validation.');

  const validationCount = Math.max(1, Math.round(people.length * 0.2));
  for (let attempt = 0; attempt < 1000; attempt++) {
    const shuffled = people.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng.rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const validationPeople = shuffled.slice(0, validationCount);
    const validationSet = new Set(validationPeople);
    const trainRaw = samples.filter((sample) => !validationSet.has(sample.person));
    const valRaw = samples.filter((sample) => validationSet.has(sample.person));
    const trainClasses = new Set(trainRaw.map((sample) => sample.y));
    const valClasses = new Set(valRaw.map((sample) => sample.y));
    if (classes.every((_, i) => trainClasses.has(i) && valClasses.has(i))) {
      return {
        trainRaw,
        valRaw,
        trainPeople: people.filter((person) => !validationSet.has(person)),
        valPeople: validationPeople
      };
    }
  }
  throw new Error('Could not create a person-disjoint split containing every class. Collect every class from multiple people.');
}

// --- Pure-JS MLP Neural Network (77 -> 64 -> 32 -> selected classes) with Adam ---
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

function trainMLP(trainData, valData, classCount, { epochs = 60, batchSize = 32, lr = 0.003 } = {}) {
  const rng = makeRng(2026);
  const inDim = trainData[0].x.length;
  const layers = createMLP(inDim, 64, 32, classCount, rng);
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

function main(args = process.argv.slice(2)) {
  const dataIdx = args.indexOf('--data');
  const epIdx = args.indexOf('--epochs');
  const file = dataIdx >= 0 ? args[dataIdx + 1] : '';
  if (!file) throw new Error('Provide real labelled data with --data <path>. Synthetic-only training is disabled.');
  const epochs = epIdx >= 0 ? Number(args[epIdx + 1]) : 60;
  if (!Number.isInteger(epochs) || epochs < 1 || epochs > 500) throw new Error('--epochs must be an integer from 1 to 500.');

  const dataPath = path.resolve(process.env.INIT_CWD || process.cwd(), file);
  const { samples, classes } = loadSamples(dataPath);
  const { trainRaw, valRaw, trainPeople, valPeople } = splitByPerson(samples, classes);
  console.log(`Loaded ${samples.length} real samples from ${dataPath} across ${trainPeople.length + valPeople.length} people.`);
  if (trainPeople.length + valPeople.length < 5) console.warn('WARNING: fewer than five people; signer-independent results may not generalize.');

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

  console.log(`Training MLP (${dim} -> 64 -> 32 -> ${classes.length}) on ${trainData.length} samples; validating on ${valData.length} samples from held-out people...`);
  const layers = trainMLP(trainData, valData, classes.length, { epochs });
  const valAcc = accuracy(layers, valData);

  // Round weights to 5 decimals to keep JSON compact (~180KB)
  const roundMat = (m) => m.map(r => r.map(v => Math.round(v * 1e5) / 1e5));
  const roundVec = (v) => v.map(x => Math.round(x * 1e5) / 1e5);

  const model = {
    version: 1,
    architecture: `MLP(${dim}->64->32->${classes.length}, ReLU, Softmax)`,
    trainedAt: new Date().toISOString(),
    classes,
    featureDim: dim,
    validationAccuracy: Math.round(valAcc * 10000) / 10000,
    validationMethod: 'person-disjoint',
    trainingPeople: trainPeople.length,
    validationPeople: valPeople.length,
    scaler: { mean: roundVec(mean), std: roundVec(std) },
    layers: layers.map(L => ({ W: roundMat(L.W), b: roundVec(L.b) })),
  };

  fs.writeFileSync(OUT_PATH, JSON.stringify(model));
  const jsOutPath = path.join(ROOT, 'shared', 'gesture-model.js');
  fs.writeFileSync(jsOutPath, `// Auto-generated by backend/scripts/train-gestures.js\nexport default ${JSON.stringify(model)};\n`);
  console.log(`Saved trained model to ${OUT_PATH} and ${jsOutPath} (${(fs.statSync(OUT_PATH).size / 1024).toFixed(1)} KB, val_acc=${(valAcc * 100).toFixed(2)}%)`);
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`Gesture training failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { CLASSES, loadSamples, main, splitByPerson };
