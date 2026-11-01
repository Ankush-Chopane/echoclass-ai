# Evaluating gesture recognition

**This repository contains no real-hand dataset and reports no accuracy figures.** The unit tests in `apps/backend/tests/gestures.test.js` use synthetic landmark skeletons: they prove the geometry code behaves as designed, not that it works on real hands, skin tones, lighting, cameras or signers.

## Collect data (with consent)
1. Get informed consent from each participant (and a guardian for minors). Record only landmarks, never video, unless consent covers video.
2. Capture at least ~10 people × each pose × 2 lighting conditions × 2 camera angles, plus plenty of `NONE` frames (resting hand, waving, pointing at the screen, mid-sentence gestures).
3. Write one JSON object per line:
```json
{"label":"POINT","person":"p01","session":"s1","landmarks":[{"x":0.5,"y":0.6,"z":0}, "... 21 points ..."]}
```
`label` is one of the poses in `docs/GESTURES.md` or `NONE`.

## Run
```bash
npm run eval:gestures -- path/to/samples.jsonl
```
The script prints samples, number of people, per-class precision/recall/support, the confusion matrix and the false-positive rate on `NONE` frames. Report it **per person and per lighting condition**, not just overall. Keep people in the test set out of any threshold tuning.

## What to claim
Only what the numbers support, for the population you tested. Poses are classroom conventions, not a sign language; never describe results as "sign-language recognition accuracy".
