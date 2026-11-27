const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadSamples, main, splitByPerson } = require('../scripts/train-gestures');

function landmarks(offset = 0) {
  return Array.from({ length: 21 }, (_, i) => ({
    x: 0.1 + i * 0.01 + offset,
    y: 0.2 + i * 0.015,
    z: 0
  }));
}

test('gesture training requires real labeled samples from separate people and never splits one person across sets', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gesture-training-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'samples.jsonl');
  const selectedClasses = ['HELLO', 'POINT', 'NONE'];
  const people = ['person-a', 'person-b', 'person-c', 'person-d', 'person-e'];
  const rows = people.flatMap((person, i) => selectedClasses.map((label) => ({
    label,
    person,
    session: `session-${i}`,
    landmarks: landmarks(i * 0.001)
  })));
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n'));

  const { samples, classes } = loadSamples(file);
  const { trainRaw, valRaw, trainPeople, valPeople } = splitByPerson(samples, classes);
  assert.equal(samples.length, rows.length);
  assert.deepEqual(classes, selectedClasses);
  assert.equal(trainPeople.some((person) => valPeople.includes(person)), false);
  assert.deepEqual(new Set(trainRaw.map((sample) => sample.y)), new Set(classes.map((_, i) => i)));
  assert.deepEqual(new Set(valRaw.map((sample) => sample.y)), new Set(classes.map((_, i) => i)));
});

test('training rejects missing signer labels, malformed landmarks, missing classes, and synthetic-only runs', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gesture-training-invalid-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'samples.jsonl');

  fs.writeFileSync(file, JSON.stringify({ label: 'HELLO', landmarks: landmarks() }));
  assert.throws(() => loadSamples(file), /person identifier/);

  fs.writeFileSync(file, JSON.stringify({ label: 'HELLO', person: 'person-a', landmarks: landmarks().slice(1) }));
  assert.throws(() => loadSamples(file), /exactly 21 finite/);

  fs.writeFileSync(file, JSON.stringify({ label: 'HELLO', person: 'person-a', landmarks: landmarks() }));
  assert.throws(() => loadSamples(file), /must include NONE examples/);
  assert.throws(() => main([]), /Synthetic-only training is disabled/);
});
