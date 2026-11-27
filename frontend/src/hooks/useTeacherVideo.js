import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Teacher camera broadcaster: captures webcam preview locally and relays
 * compressed JPEG frames (~10 fps, 480x270) over the classroom WebSocket so
 * students see the teacher's video reliably on LAN and cloud deployments.
 */
export function useTeacherVideo({ sendRaw }) {
  const [status, setStatus] = useState('off'); // off | starting | on | error
  const [error, setError] = useState('');
  const videoRef = useRef(null);
  const stateRef = useRef({ stream: null, timer: null, canvas: null, running: false });
  const sendRef = useRef(sendRaw);
  sendRef.current = sendRaw;

  const stop = useCallback(() => {
    const s = stateRef.current;
    const wasRunning = s.running;
    s.running = false;
    if (s.timer) { clearInterval(s.timer); s.timer = null; }
    if (s.stream) { s.stream.getTracks().forEach((t) => t.stop()); s.stream = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    if (wasRunning) sendRef.current?.({ type: 'video_state', active: false });
    setStatus('off');
  }, []);

  const start = useCallback(async () => {
    if (stateRef.current.running) return;
    setError('');
    setStatus('starting');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('Camera access requires HTTPS (or localhost) in a modern browser.');
      setStatus('error');
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 360 }, facingMode: 'user' },
        audio: false,
      });
    } catch (e) {
      const msg =
        e.name === 'NotAllowedError' || e.name === 'SecurityError' ? 'Camera permission was blocked. Allow camera access in your browser bar.'
        : e.name === 'NotFoundError' || e.name === 'OverconstrainedError' ? 'No camera was found on this device.'
        : e.name === 'NotReadableError' ? 'The camera is already in use by another application.'
        : `Could not start camera (${e.name || 'error'}).`;
      setError(msg);
      setStatus('error');
      return;
    }

    const s = stateRef.current;
    s.stream = stream;
    s.running = true;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => stop());

    const video = videoRef.current;
    if (video) {
      video.srcObject = stream;
      try { await video.play(); } catch { /* ignore autoplay race */ }
    }

    if (!s.canvas) {
      s.canvas = document.createElement('canvas');
      s.canvas.width = 480;
      s.canvas.height = 270;
    }
    const ctx = s.canvas.getContext('2d');

    sendRef.current?.({ type: 'video_state', active: true });
    setStatus('on');

    s.timer = setInterval(() => {
      if (!s.running || !videoRef.current || videoRef.current.readyState < 2) return;
      try {
        ctx.drawImage(videoRef.current, 0, 0, s.canvas.width, s.canvas.height);
        const data = s.canvas.toDataURL('image/jpeg', 0.55);
        if (data.length <= 58000) {
          sendRef.current?.({ type: 'video_frame', data });
        }
      } catch { /* skip bad frame */ }
    }, 100);
  }, [stop]);

  useEffect(() => stop, [stop]);

  return { videoRef, status, active: status === 'on', error, start, stop };
}
