/* EchoClass gesture engine – pure geometry on MediaPipe's 21 hand landmarks (ES module; shared by the React app and the Node tests).
 *
 * WHAT THIS IS: a rule-based recogniser for 12 application-defined, static, one-hand poses.
 * WHAT THIS IS NOT: sign-language translation. Poses are not validated signs of ISL, ASL or any other sign language.
 *
 * "clarity" is a geometric margin (how far the finger measurements are from their decision thresholds, 0..1).
 * It is NOT a probability or an accuracy figure and must never be displayed as a percentage of confidence.
 */
const factory = function () {
  const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
  const FINGERS = { index: [5, 6, 8], middle: [9, 10, 12], ring: [13, 14, 16], pinky: [17, 18, 20] };
  const TH = { finger: 1.5, fingerBand: 0.35, thumb: 0.62, thumbBand: 0.25, pinch: 0.38, pinchBand: 0.2, thumbVertical: 0.5, minPalm: 0.04 };
  const clamp01 = (x) => Math.max(0, Math.min(1, x));

  /** Measurements + which digits are extended, each with its own decision margin. */
  function analyze(lm) {
    const palm = d(lm[0], lm[9]) || 1e-6;
    const f = {}, m = {};
    for (const [name, [mcp, , tip]] of Object.entries(FINGERS)) { const r = d(lm[tip], lm[0]) / (d(lm[mcp], lm[0]) || 1e-6); f[name] = r > TH.finger; m[name] = clamp01(Math.abs(r - TH.finger) / TH.fingerBand); }
    const tr = d(lm[4], lm[5]) / palm;
    f.thumb = tr > TH.thumb && d(lm[4], lm[17]) > d(lm[3], lm[17]); m.thumb = clamp01(Math.abs(tr - TH.thumb) / TH.thumbBand);
    const thumbVertical = (lm[4].y - lm[0].y) / palm;        // negative = tip above wrist (image y grows downward)
    const pinch = d(lm[4], lm[8]) / palm, spread = d(lm[8], lm[20]) / palm;
    return { f, m, palm, thumbVertical, pinch, spread, count: ['thumb', 'index', 'middle', 'ring', 'pinky'].filter(k => f[k]).length };
  }

  /** Rule table. Each rule says which digits must be extended/folded; `uses` lists measurements that decide it (for clarity). */
  const RULES = [
    ['OK',          (a) => a.pinch < TH.pinch && a.f.middle && a.f.ring && a.f.pinky, (a) => ({ pinch: clamp01((TH.pinch - a.pinch) / TH.pinchBand + 0.2), middle: a.m.middle, ring: a.m.ring, pinky: a.m.pinky })],
    ['HELLO',       (a) => a.count === 5,                                              (a) => all(a, ['thumb', 'index', 'middle', 'ring', 'pinky'])],
    ['FOUR',        (a) => !a.f.thumb && a.f.index && a.f.middle && a.f.ring && a.f.pinky, (a) => all(a, ['thumb', 'index', 'middle', 'ring', 'pinky'])],
    ['ILY',         (a) => a.f.thumb && a.f.index && !a.f.middle && !a.f.ring && a.f.pinky, (a) => all(a, ['thumb', 'index', 'middle', 'ring', 'pinky'])],
    ['HELP',        (a) => a.f.thumb && !a.f.index && !a.f.middle && !a.f.ring && a.f.pinky, (a) => all(a, ['thumb', 'index', 'middle', 'ring', 'pinky'])],
    ['THREE',       (a) => !a.f.thumb && a.f.index && a.f.middle && a.f.ring && !a.f.pinky, (a) => all(a, ['thumb', 'index', 'middle', 'ring', 'pinky'])],
    ['PEACE',       (a) => !a.f.thumb && a.f.index && a.f.middle && !a.f.ring && !a.f.pinky, (a) => all(a, ['thumb', 'index', 'middle', 'ring', 'pinky'])],
    ['L',           (a) => a.f.thumb && a.f.index && !a.f.middle && !a.f.ring && !a.f.pinky, (a) => all(a, ['thumb', 'index', 'middle', 'ring', 'pinky'])],
    ['POINT',       (a) => !a.f.thumb && a.f.index && !a.f.middle && !a.f.ring && !a.f.pinky, (a) => all(a, ['thumb', 'index', 'middle', 'ring', 'pinky'])],
    ['THUMBS_UP',   (a) => a.f.thumb && !a.f.index && !a.f.middle && !a.f.ring && !a.f.pinky && a.thumbVertical < -TH.thumbVertical, (a) => ({ ...all(a, ['thumb', 'index', 'middle', 'ring', 'pinky']), vertical: clamp01((-a.thumbVertical - TH.thumbVertical) / 0.4 + 0.2) })],
    ['THUMBS_DOWN', (a) => a.f.thumb && !a.f.index && !a.f.middle && !a.f.ring && !a.f.pinky && a.thumbVertical > TH.thumbVertical,  (a) => ({ ...all(a, ['thumb', 'index', 'middle', 'ring', 'pinky']), vertical: clamp01((a.thumbVertical - TH.thumbVertical) / 0.4 + 0.2) })],
    ['FIST',        (a) => a.count === 0 || (a.f.thumb && !a.f.index && !a.f.middle && !a.f.ring && !a.f.pinky && Math.abs(a.thumbVertical) <= TH.thumbVertical), (a) => all(a, ['index', 'middle', 'ring', 'pinky'])],
  ];
  function all(a, keys) { const o = {}; keys.forEach(k => (o[k] = a.m[k])); return o; }

  /**
   * Detailed evaluation of one frame.
   * status: 'no_hand' | 'too_small' | 'unsupported' | 'borderline' | 'recognised'
   */
  function evaluate(lm, { minClarity = 0.25 } = {}) {
    if (!Array.isArray(lm) || lm.length < 21 || lm.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return { status: 'no_hand', gesture: null, clarity: 0 };
    const a = analyze(lm);
    if (a.palm < TH.minPalm) return { status: 'too_small', gesture: null, clarity: 0, analysis: a };
    for (const [key, test, margins] of RULES) {
      if (test(a)) {
        const clarity = Math.min(...Object.values(margins(a)));
        return { status: clarity >= minClarity ? 'recognised' : 'borderline', gesture: key, clarity: Math.round(clarity * 100) / 100, analysis: a };
      }
    }
    return { status: 'unsupported', gesture: null, clarity: 0, analysis: a };
  }
  /** Backwards-compatible: gesture key (any clarity) or null. */
  const classify = (lm) => { const r = evaluate(lm, { minClarity: 0 }); return r.gesture; };

  /** Registry – the single, documented list of supported poses (docs/GESTURES.md is generated from this). */
  const DEFAULTS = {
    HELLO:       { label: 'Open hand',           phrase: 'Hello',               request: null,         hand: 'All five digits extended, any orientation.',                                   limits: 'Easily triggered by an open hand while talking or waving; needs a held pose.' },
    FIST:        { label: 'Closed fist',         phrase: 'Yes',                 request: null,         hand: 'No finger extended; thumb tucked or resting on the side (not vertical).',      limits: 'A resting hand can look like a fist; thumb-up/down are checked first.' },
    THUMBS_UP:   { label: 'Thumbs up',           phrase: 'I understand',        request: 'understood', hand: 'Only the thumb extended and pointing clearly upward in the image.',            limits: 'Uses image-up, so a sideways camera or a strongly rotated hand can misread.' },
    THUMBS_DOWN: { label: 'Thumbs down',         phrase: "I don't understand",  request: 'repeat',     hand: 'Only the thumb extended and pointing clearly downward in the image.',          limits: 'Same image-orientation dependence as thumbs up.' },
    POINT:       { label: 'Index finger up',     phrase: 'I have a question',   request: 'raise_hand', hand: 'Only the index finger extended.',                                                limits: 'Pointing at something on screen looks identical.' },
    PEACE:       { label: 'Two fingers (V)',     phrase: 'Please repeat that',  request: 'repeat',     hand: 'Index and middle extended; ring, pinky and thumb folded.',                       limits: 'Ring finger half-folded can read as three fingers.' },
    THREE:       { label: 'Three fingers (W)',   phrase: 'Please slow down',    request: 'slow_down',  hand: 'Index, middle and ring extended; pinky and thumb folded.',                       limits: 'Pinky half-folded can read as four fingers.' },
    FOUR:        { label: 'Four fingers',        phrase: 'Wait, please',        request: null,         hand: 'Index to pinky extended; thumb folded across the palm.',                         limits: 'A relaxed thumb can read as an open hand.' },
    L:           { label: 'L shape',             phrase: 'Please speak louder', request: 'louder',     hand: 'Thumb and index extended; the other three folded.',                              limits: 'Thumb-out detection is the least reliable measurement.' },
    OK:          { label: 'OK sign',             phrase: 'Okay',                request: null,         hand: 'Thumb tip touching index tip; middle, ring and pinky extended.',                  limits: 'Needs the thumb/index contact visible to the camera.' },
    HELP:        { label: 'Thumb + pinky (Y)',   phrase: 'I need help',         request: 'raise_hand', hand: 'Thumb and pinky extended; index, middle, ring folded.',                          limits: 'Same shape as the ASL letter Y and the informal "call me" gesture; here it only means what the table says.' },
    ILY:         { label: 'Thumb, index, pinky', phrase: 'Thank you',           request: null,         hand: 'Thumb, index and pinky extended; middle and ring folded.',                        limits: 'This shape is the ASL "I love you" sign. Mapping it to "Thank you" is a classroom convention, not a sign-language rule – rename it in the app if that confuses your class.' },
  };
  const CONTEXT = 'Application-defined hand poses chosen to be easy for a camera to separate. They are NOT validated signs of Indian Sign Language, ASL or any other sign language, and the phrases are classroom conventions.';

  /** Classifier interface so a trained model can replace the rules later: { name, evaluate(landmarks, opts) -> {status, gesture, clarity} } */
  const classifiers = { geometric: () => ({ name: 'geometric', evaluate }) };
  const registerClassifier = (name, factory) => { classifiers[name] = factory; };
  const createClassifier = (name = 'geometric', opts) => { if (!classifiers[name]) throw new Error('Unknown classifier: ' + name); return classifiers[name](opts); };

  /** Debounces per-frame guesses into confirmed signs: needs `hold` consecutive frames, fires once, and re-arms only after a
      different sign is confirmed or the hand is absent for `release` frames. Borderline/unsupported frames reset the hold. */
  function createTracker({ hold = 9, release = 10 } = {}) {
    let cand = null, run = 0, fired = null, miss = 0;
    return {
      push(g) {
        if (g == null) { miss++; cand = null; run = 0; if (miss >= release) fired = null; return null; }
        miss = 0;
        if (g === cand) run++; else { cand = g; run = 1; }
        if (run >= hold && fired !== g) { fired = g; return g; }
        return null;
      },
      progress() { return cand && cand !== fired ? Math.min(run / hold, 1) : cand ? 1 : 0; },
      reset() { cand = null; run = 0; fired = null; miss = 0; },
    };
  }
  return { analyze, classify, evaluate, createClassifier, registerClassifier, createTracker, DEFAULTS, CONTEXT, THRESHOLDS: TH };
};
const G = factory();
export const { analyze, classify, evaluate, createClassifier, registerClassifier, createTracker, DEFAULTS, CONTEXT, THRESHOLDS } = G;
export default G;
