import { useState, useRef, useCallback, useEffect } from 'react';
import Gestures from '@echoclass/shared/gestures';

/**
 * Real hand tracking: MediaPipe HandLandmarker (WASM, in the browser) -> 21 landmarks -> shared gesture engine.
 * Nothing is simulated. Every state is reported honestly: permission, camera, model, hand visible, pose recognised / unclear / unsupported.
 * Video never leaves the device; only the recognised phrase is sent by the caller.
 */
const GOOGLE_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const WASM_BASE = '/vendor/mediapipe/wasm';
const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];

export class TrackerError extends Error { constructor(code, message) { super(message); this.code = code; } }

export async function cameraPermission() {
  try { return (await navigator.permissions.query({ name: 'camera' })).state; } catch { return 'unknown'; }
}

async function pickModel() {
  try {
    const r = await fetch('/models/hand_landmarker.task', { method: 'HEAD' });
    if (r.ok && Number(r.headers.get('content-length')) > 1e6 && !/text\/html/.test(r.headers.get('content-type') || '')) return { url: '/models/hand_landmarker.task', source: 'this server' };
  } catch { /* fall through to the CDN */ }
  return { url: GOOGLE_MODEL, source: 'Google CDN' };
}

export function useHandTracker({ onGesture, hold = 10, release = 12 } = {}) {
  const [status, setStatus] = useState('off');   // off | starting | loading-model | running | error
  const [error, setError] = useState(null);      // { code, message }
  const [permission, setPermission] = useState('unknown');
  const [modelSource, setModelSource] = useState('');
  const [view, setView] = useState({ hand: false, evaluation: null, progress: 0, fingers: {} });
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const parts = useRef(null);
  const cb = useRef({ onGesture }); cb.current = { onGesture };
  const tracker = useRef(Gestures.createTracker({ hold, release }));
  const lastPaint = useRef(0);

  useEffect(() => { cameraPermission().then(setPermission); }, []);

  const stop = useCallback(() => {
    const p = parts.current; parts.current = null;
    if (p) {
      p.running = false; cancelAnimationFrame(p.raf); document.removeEventListener('visibilitychange', p.onVis);
      try { p.landmarker?.close(); } catch { /* ignore */ }
      p.stream?.getTracks().forEach((t) => t.stop());
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    const c = canvasRef.current; c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    tracker.current.reset();
    setView({ hand: false, evaluation: null, progress: 0, fingers: {} });
    setStatus((s) => (s === 'error' ? s : 'off'));
  }, []);

  const fail = useCallback((code, message) => { stop(); setError({ code, message }); setStatus('error'); }, [stop]);

  const start = useCallback(async () => {
    if (parts.current) return;
    setError(null); setStatus('starting');
    if (!navigator.mediaDevices?.getUserMedia) return fail('unsupported', 'This browser cannot use the camera here. Camera access needs HTTPS (or localhost) and a modern browser.');
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false }); }
    catch (e) {
      cameraPermission().then(setPermission);
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') return fail('denied', 'Camera permission was blocked. Allow the camera in your browser’s address bar, then try again.');
      if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') return fail('no_camera', 'No camera was found on this device.');
      if (e.name === 'NotReadableError') return fail('in_use', 'The camera is being used by another app. Close it and try again.');
      return fail('unsupported', `The camera could not be started (${e.name || 'error'}).`);
    }
    cameraPermission().then(setPermission);
    const p = { stream, running: true, raf: 0, landmarker: null, lastT: -1, onVis: null };
    parts.current = p;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => fail('camera_lost', 'The camera was disconnected.'));
    try {
      const video = videoRef.current; if (!video) throw new Error('video element missing');
      video.srcObject = stream; await video.play();
      setStatus('loading-model');
      const [{ FilesetResolver, HandLandmarker }, model] = await Promise.all([import('@mediapipe/tasks-vision'), pickModel()]);
      setModelSource(model.source);
      const fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
      const make = (delegate) => HandLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: model.url, delegate }, runningMode: 'VIDEO', numHands: 1, minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.6, minTrackingConfidence: 0.5 });
      p.landmarker = await make('GPU').catch(() => make('CPU'));
    } catch (e) {
      if (parts.current !== p) return;       // stopped while loading
      return fail('model', `The hand-tracking model could not be loaded, so sign recognition is unavailable. You can still type or use quick phrases. (${e.message || e})`);
    }
    if (parts.current !== p) { try { p.landmarker.close(); } catch { /* ignore */ } return; }
    setStatus('running');

    const video = videoRef.current, canvas = canvasRef.current;
    p.onVis = () => { if (document.hidden) { tracker.current.reset(); canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height); } };
    document.addEventListener('visibilitychange', p.onVis);

    const draw = (lm) => {
      if (!canvas || !video) return;
      if (canvas.width !== video.videoWidth) { canvas.width = video.videoWidth; canvas.height = video.videoHeight; }
      const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!lm) return;
      const W = canvas.width, H = canvas.height; ctx.lineWidth = 3; ctx.strokeStyle = '#5eead4'; ctx.fillStyle = '#ffffff';
      ctx.beginPath(); for (const [a, b] of CONNECTIONS) { ctx.moveTo(lm[a].x * W, lm[a].y * H); ctx.lineTo(lm[b].x * W, lm[b].y * H); } ctx.stroke();
      for (const pt of lm) { ctx.beginPath(); ctx.arc(pt.x * W, pt.y * H, 4, 0, 6.3); ctx.fill(); }
    };

    const loop = () => {
      if (!p.running) return;
      if (!document.hidden && video.readyState >= 2 && video.currentTime !== p.lastT) {
        p.lastT = video.currentTime;
        try {
          const res = p.landmarker.detectForVideo(video, performance.now());
          const lm = res.landmarks?.[0] || null;
          draw(lm);
          const ev = lm ? Gestures.evaluate(lm) : { status: 'no_hand', gesture: null, clarity: 0 };
          const fired = tracker.current.push(ev.status === 'recognised' ? ev.gesture : null);
          if (fired) cb.current.onGesture?.(fired, ev);
          const now = performance.now();
          if (now - lastPaint.current > 120 || fired) {            // throttle React renders to ~8/s
            lastPaint.current = now;
            setView({ hand: Boolean(lm), evaluation: ev, progress: tracker.current.progress(), fingers: ev.analysis?.f || {} });
          }
        } catch { /* skip a bad frame */ }
      }
      p.raf = requestAnimationFrame(loop);
    };
    p.raf = requestAnimationFrame(loop);
  }, [fail]);

  useEffect(() => stop, [stop]);

  return { videoRef, canvasRef, status, error, permission, modelSource, ...view, running: status === 'running', start, stop };
}
