import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Streams the teacher's microphone to the server's OFFLINE Vosk recogniser as 16 kHz PCM chunks over the live socket.
 * The recogniser answers with `interim` / `caption` messages that arrive through useWebSocket like any other speech.
 * Needs: Python + `pip install vosk` + `npm run fetch-speech-model` on the server (see /api/config -> offlineSpeech).
 */
const toBase64 = (buffer) => {
  const bytes = new Uint8Array(buffer); let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export function useOfflineSpeech({ send, available }) {
  const [state, setState] = useState('off');        // off | starting | listening | error
  const [message, setMessage] = useState('');
  const parts = useRef({ stream: null, ctx: null, node: null });
  const sendRef = useRef(send); sendRef.current = send;

  const stop = useCallback(() => {
    const { stream, ctx, node } = parts.current; parts.current = { stream: null, ctx: null, node: null };
    if (node) { node.port.onmessage = null; try { node.disconnect(); } catch { /* ignore */ } }
    stream?.getTracks().forEach((t) => t.stop());
    ctx?.close().catch(() => {});
    if (stream) sendRef.current({ type: 'speech_stop' });
    setState('off');
  }, []);

  const start = useCallback(async () => {
    if (!available) { setState('error'); setMessage('The offline speech engine is not installed on this server.'); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext) { setState('error'); setMessage('This browser cannot capture microphone audio here (needs HTTPS or localhost).'); return; }
    setState('starting'); setMessage('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      let ctx;
      try { ctx = new AudioContext({ sampleRate: 16000 }); } catch { ctx = new AudioContext(); }   // the worklet resamples if 16 kHz is unavailable
      await ctx.audioWorklet.addModule('/pcm-worklet.js');
      const node = new AudioWorkletNode(ctx, 'pcm-chunker');
      node.port.onmessage = (ev) => { sendRef.current({ type: 'speech_chunk', data: toBase64(ev.data) }); };
      ctx.createMediaStreamSource(stream).connect(node);
      parts.current = { stream, ctx, node };
      setState('listening');
    } catch (e) {
      stop();
      setState('error');
      setMessage(e.name === 'NotAllowedError' ? 'Microphone permission is blocked. Allow it in the address bar and try again.' : 'Could not start the microphone: ' + (e.message || e.name));
    }
  }, [available, stop]);

  useEffect(() => stop, [stop]);
  return { state, message, listening: state === 'listening' || state === 'starting', start, stop, setMessage };
}
