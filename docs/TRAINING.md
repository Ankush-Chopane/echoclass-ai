# Training a learned gesture classifier (optional path)

Nothing here is trained or shipped. The app currently uses rule-based geometry (`packages/shared/gestures.js`). The code is structured so a learned model can replace it.

## Interface
A classifier takes 21 MediaPipe landmarks and returns `{status, gesture, clarity, reason}` like `evaluate()` in `packages/shared/gestures.js`. `clarity` must remain an honest quantity (e.g. margin to the runner-up class) – do not display a softmax score as "confidence" without calibrating it.

## Suggested process
1. Collect and label data following `docs/EVALUATION.md` (consent, many people, `NONE` class).
2. Normalise landmarks: translate to the wrist, scale by palm size, optionally mirror left/right.
3. Train a small model (k-NN or small MLP is enough for ~12 poses) in a separate repo/notebook; split **by person**.
4. Evaluate with `npm run eval:gestures` using a wrapper that calls your classifier; compare against the rule-based baseline on the same held-out people.
5. Export to a tiny JSON/ONNX/TF.js artefact, load it lazily in `apps/classroom-web/src/hooks/useHandTracker.js`, fall back to the rule-based engine if loading fails.
6. Update `docs/GESTURES.md`, the privacy page, and the README with measured limits.

Dynamic signs and full sign languages need sequence models, two hands, face and body; that is out of scope here.
