// Evaluate the gesture classifier on REAL labelled recordings.
//   node scripts/eval-gestures.js data/gesture-eval.jsonl [--classifier geometric|mlp]
// Each line: {"label":"POINT"|"NONE"|..., "person":"p01", "session":"s1", "landmarks":[{x,y,z} x21]}
// Use "NONE" for frames showing hands that are not any supported pose (needed to measure false positives).
// This script reports numbers only for the data you give it. It ships with no dataset and invents no results.
const fs = require('fs');
const path = require('path');
const G = require('@echoclass/shared/gestures').default;

function evaluateFile(file, opts = {}) {
  const rows = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l, i) => { try { return JSON.parse(l); } catch { throw new Error(`Line ${i + 1} is not valid JSON`); } });
  if (!rows.length) throw new Error('No samples found.');
  const classifierName = opts.classifier || 'geometric';
  const classifier = G.createClassifier(classifierName);
  const labels = [...new Set([...rows.map(r => r.label), ...Object.keys(G.DEFAULTS), ...G.MODEL_INFO.classes, 'NONE'])].sort();
  const pred = (r) => {
    const options = classifierName === 'geometric' ? { minClarity: opts.minClarity ?? 0.25 } : undefined;
    const e = classifier.evaluate(r.landmarks, options);
    return e.status === 'recognised' ? e.gesture : 'NONE';
  };
  const cm = Object.fromEntries(labels.map(a => [a, Object.fromEntries(labels.map(b => [b, 0]))]));
  const persons = new Set();
  for (const r of rows) { cm[r.label][pred(r)]++; persons.add(r.person || 'unknown'); }
  const stats = labels.map(l => {
    const tp = cm[l][l], fn = labels.reduce((n, b) => n + (b === l ? 0 : cm[l][b]), 0), fp = labels.reduce((n, a) => n + (a === l ? 0 : cm[a][l]), 0);
    return { label: l, support: tp + fn, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null };
  });
  const none = rows.filter(r => r.label === 'NONE'), fpr = none.length ? none.filter(r => pred(r) !== 'NONE').length / none.length : null;
  return { samples: rows.length, people: persons.size, classifier: classifierName, labels, confusionMatrix: cm, perClass: stats, falsePositiveRateOnNone: fpr };
}
module.exports = { evaluateFile };

if (require.main === module) {
  const file = process.argv[2], classifierIndex = process.argv.indexOf('--classifier');
  const classifier = classifierIndex >= 0 ? process.argv[classifierIndex + 1] : 'geometric';
  if (!file) { console.error('Usage: node scripts/eval-gestures.js <samples.jsonl> [--classifier geometric|mlp]'); process.exit(1); }
  const dataPath = path.resolve(process.env.INIT_CWD || process.cwd(), file);
  const r = evaluateFile(dataPath, { classifier });
  console.log(`Classifier: ${r.classifier}  Samples: ${r.samples}  People: ${r.people}`);
  if (r.people < 5) console.log('WARNING: fewer than 5 people – results will not generalise; collect more participants, lighting and cameras.');
  console.table(r.perClass.filter(s => s.support || s.precision != null).map(s => ({ label: s.label, support: s.support, precision: s.precision?.toFixed(3) ?? '–', recall: s.recall?.toFixed(3) ?? '–' })));
  console.log('False-positive rate on NONE frames:', r.falsePositiveRateOnNone == null ? 'no NONE samples supplied' : r.falsePositiveRateOnNone.toFixed(3));
  console.log('Confusion matrix (rows = true label, columns = predicted):'); console.table(r.confusionMatrix);
}
