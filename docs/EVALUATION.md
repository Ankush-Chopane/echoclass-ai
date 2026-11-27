# Evaluating classroom pose recognition

**There is no consented real-signer dataset in this repository and no measured real-world recognition accuracy.** The current labels are application-defined classroom cues, not validated ISL signs. Unit tests use synthetic landmarks and only check code behavior.

## Collect evaluation data

Get informed consent from every participant (and guardian consent for minors). Ask an ISL instructor and Deaf signers to validate any proposed ISL sign and its meaning. Store pseudonymous person IDs. Record landmarks only unless video capture is explicitly consented to.

Capture each cue and `NONE` (ordinary, resting, partial, or unsupported movements) from multiple people, sessions, camera angles, and lighting conditions. Keep all recordings from one person in the same split. The training script does this automatically when it receives a `person` value for every sample.

Each JSONL line must contain a valid label, a pseudonymous `person` ID, and exactly 21 finite landmarks:

```json
{"label":"POINT","person":"p01","session":"s1","landmarks":[{"x":0.5,"y":0.6,"z":0}, "... 20 more points ..."]}
```

The sample is abbreviated for readability; the actual file must contain all 21 landmark objects.

## Train and evaluate

```bash
npm run train:gestures -- --data path/to/samples.jsonl
npm run eval:gestures -- path/to/held-out-samples.jsonl --classifier mlp
npm run eval:gestures -- path/to/held-out-samples.jsonl --classifier geometric
```

The training command reports a person-disjoint validation score. The evaluation command reports per-class precision/recall, a confusion matrix, and false-positive rate on `NONE`. `geometric` is the hand-written baseline; `mlp` evaluates the currently loaded neural-network model. Use genuinely held-out people for final evaluation and do not tune thresholds against that final set.

Report results by signer and recording condition, not only as one aggregate number. Never describe these results as ISL recognition accuracy unless the vocabulary and examples were validated by ISL experts and the evaluation population supports that claim.
