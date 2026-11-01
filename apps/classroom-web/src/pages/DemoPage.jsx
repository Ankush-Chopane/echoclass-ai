import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../components/common/Button';
import { StatusBadge } from '../components/common/StatusBadge';
import { SignInputPanel } from '../components/live/SignInputPanel';
import { useAccessibility } from '../hooks/useAccessibility';
import { useSpeechRecognition } from '../hooks/useSpeechRecognition';

// PRE-WRITTEN sample lecture. It is a script, not recognition: every line carries the "sample" label so nobody mistakes it for real output.
const SAMPLE = [
  ['Prof. Sharma', 'Welcome everyone. Today we are exploring the architecture of modern operating systems.'],
  ['Prof. Sharma', 'Notice how process scheduling keeps the processor busy while programs wait for input.'],
  ['Alex (sample student)', 'I understand.'],
  ['Prof. Sharma', 'A context switch has an overhead because register states must be saved and restored.'],
  ['Maya (sample student)', 'Please slow down.'],
  ['Prof. Sharma', 'Certainly. Let us slow down and look at the process control block in memory.']
];

/** Public demo: nothing here is sent to a server or saved. The microphone and camera sections are the real thing, running locally. */
export function DemoPage() {
  const { captionSize } = useAccessibility();
  const [lines, setLines] = useState([]);
  const [next, setNext] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [interim, setInterim] = useState('');
  const bottom = useRef(null);
  const add = (speaker, text, tag) => setLines((l) => [...l, { speaker, text, tag }]);

  useEffect(() => {
    if (!playing) return undefined;
    if (next >= SAMPLE.length) { setPlaying(false); return undefined; }
    const t = setTimeout(() => { add(...SAMPLE[next], 'sample'); setNext((n) => n + 1); }, 2200);
    return () => clearTimeout(t);
  }, [playing, next]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [lines, interim]);

  const mic = useSpeechRecognition({ lang: 'en-IN', onInterim: setInterim, onFinal: (t) => { setInterim(''); add('You (your microphone)', t, 'speech'); } });
  const reset = () => { setLines([]); setNext(0); setPlaying(false); };

  return (
    <div className="flex flex-col gap-6">
      <header className="p-6 rounded-2xl bg-slate-900 border border-slate-800">
        <StatusBadge status="warning" label="DEMO · nothing is sent or saved" />
        <h1 className="text-2xl font-black text-white mt-2">Try EchoClass AI</h1>
        <p className="text-sm text-slate-400 mt-1">Play a pre-written sample lecture to see how captions look, or use your own microphone and camera. Everything here stays in your browser. <Link to="/register" className="underline text-emerald-300">Create an account</Link> to run a real class.</p>
        <div className="flex flex-wrap gap-2 mt-4">
          <Button size="sm" onClick={() => setPlaying((p) => !p)} disabled={next >= SAMPLE.length && !playing}>{playing ? 'Pause sample' : next === 0 ? '▶ Play sample lecture' : '▶ Continue sample'}</Button>
          <Button size="sm" variant="secondary" onClick={reset}>Reset</Button>
          <Button size="sm" variant={mic.listening ? 'danger' : 'secondary'} aria-pressed={mic.listening} onClick={mic.listening ? mic.stop : mic.start} disabled={!mic.supported}>{mic.listening ? '■ Stop microphone' : '🎙 Use my microphone'}</Button>
        </div>
        {!mic.supported && <p className="text-xs text-amber-300 mt-2">This browser has no speech recognition (Firefox). Use Chrome, Edge or Safari for the microphone demo.</p>}
        {mic.message && <p role="alert" className="text-xs text-amber-300 mt-2">{mic.message}</p>}
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="lg:col-span-2 p-4 rounded-2xl bg-slate-950 border border-slate-800 min-h-[320px] max-h-[60vh] overflow-y-auto flex flex-col gap-3" aria-label="Demo captions" role="log">
          {lines.length === 0 && !interim && <p className="text-slate-400 text-sm italic m-auto text-center">Press “Play sample lecture”, or start your microphone and speak.</p>}
          {lines.map((c, i) => (
            <article key={i} className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
              <div className="text-xs flex items-center gap-2 mb-1"><b className="text-slate-200">{c.speaker}</b>
                <span className={`text-[10px] uppercase font-mono px-1.5 py-0.5 rounded ${c.tag === 'sample' ? 'bg-slate-700 text-slate-300' : c.tag === 'sign' ? 'bg-purple-500/20 text-purple-300' : 'bg-emerald-500/20 text-emerald-300'}`}>{c.tag === 'sample' ? 'sample (pre-written)' : c.tag === 'sign' ? 'sign (your camera)' : c.tag}</span></div>
              <p style={{ fontSize: `${captionSize}px`, lineHeight: 1.35 }} className="font-medium text-slate-100">{c.text}</p>
            </article>
          ))}
          {interim && <div className="p-3 rounded-xl border-2 border-dashed border-emerald-500/40" aria-hidden="true"><p style={{ fontSize: `${captionSize}px` }} className="italic text-emerald-200">{interim}</p></div>}
          <div ref={bottom} />
        </section>
        <SignInputPanel onSend={(text, source) => add(source === 'sign' ? 'You (camera sign)' : 'You', text, source === 'sign' ? 'sign' : 'typed')} />
      </div>
    </div>
  );
}
