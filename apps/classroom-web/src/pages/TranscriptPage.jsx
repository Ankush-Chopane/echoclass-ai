import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../services/api';
import { Button } from '../components/common/Button';
import { Modal } from '../components/common/Modal';
import { LoadingIndicator, EmptyState } from '../components/common/StatusBadge';

const mmss = (ms) => `${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
const List = ({ items, ordered }) => (items?.length ? React.createElement(ordered ? 'ol' : 'ul', { className: `text-sm text-slate-300 space-y-1 ${ordered ? 'list-decimal' : 'list-disc'} list-inside` }, items.map((x, i) => <li key={i}>{x}</li>)) : <p className="text-xs text-slate-400">None found in this lecture.</p>);

function Highlight({ text, term }) {
  if (!term) return text;
  const i = text.toLowerCase().indexOf(term.toLowerCase());
  if (i < 0) return text;
  return <>{text.slice(0, i)}<mark className="bg-amber-300/80 text-black rounded px-0.5">{text.slice(i, i + term.length)}</mark>{text.slice(i + term.length)}</>;
}

export function TranscriptPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isTeacher } = useAuth();

  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');
  const [items, setItems] = useState([]);
  const [flags, setFlags] = useState({});
  const [next, setNext] = useState(null);
  const [search, setSearch] = useState('');
  const [onlyConfusing, setOnlyConfusing] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [ai, setAi] = useState({ state: 'idle', data: null, error: '' });     // idle | loading | done | error
  const [consentOpen, setConsentOpen] = useState(false);
  const [agree, setAgree] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    api.getSession(id).then((d) => {
      if (cancelled) return;
      if (!d.session.ended_at) { navigate(`/classrooms/${d.classroom.id}/live`, { replace: true }); return; }
      setMeta(d); if (d.ai.cached) setAi({ state: 'done', data: d.ai.cached, error: '' });
    }).catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
  }, [id, navigate]);

  // Captions are cursor-paginated and searched on the server (SQLite FTS); the browser never downloads a whole lecture at once.
  const loadCaptions = useCallback(async (append, after = 0) => {
    const mine = ++reqId.current;
    setListLoading(true);
    try {
      const r = await api.getCaptions(id, { after, limit: 200, q: search.trim() });
      if (mine !== reqId.current) return;
      setItems((prev) => (append ? [...prev, ...r.items] : r.items)); setFlags(r.flags); setNext(r.nextAfter);
    } catch (e) { if (mine === reqId.current) setNotice(e.message); }
    finally { if (mine === reqId.current) setListLoading(false); }
  }, [id, search]);
  useEffect(() => { if (!meta) return undefined; const t = setTimeout(() => loadCaptions(false), search ? 300 : 0); return () => clearTimeout(t); }, [meta, loadCaptions, search]);

  const download = async (fmt) => { setNotice(`Preparing ${fmt.toUpperCase()}…`); try { const name = await api.exportTranscript(id, fmt); setNotice(`Downloaded ${name}`); } catch (e) { setNotice(e.message); } };

  async function generate(force) {
    setConsentOpen(false); setAgree(false);
    setAi((a) => ({ ...a, state: 'loading', error: '' }));
    try { setAi({ state: 'done', data: await api.generateAiSummary(id, { force }), error: '' }); }
    catch (e) { setAi((a) => ({ state: a.data ? 'done' : 'error', data: a.data, error: `${e.message}${e.data?.fallback ? ' ' + e.data.fallback : ''}` })); }
  }
  async function deleteLecture() {
    try { await api.deleteSession(id); navigate(`/classrooms/${meta.classroom.id}`); } catch (e) { setNotice(e.message); setDeleteOpen(false); }
  }

  if (error) return <div role="alert" className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300">{error} <Link to="/dashboard" className="underline ml-2">Dashboard</Link></div>;
  if (!meta) return <LoadingIndicator text="Loading transcript…" />;

  const { session, classroom, summary, requests, confusing } = meta;
  const rows = onlyConfusing ? items.filter((c) => flags[c.id]?.confusing) : items;
  const totalRequests = Object.values(requests || {}).reduce((a, b) => a + b, 0);
  const a = ai.data;

  return (
    <div className="flex flex-col gap-6">
      <header className="p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <Link to={`/classrooms/${classroom.id}`} className="text-xs text-slate-400 hover:text-white">← {classroom.name}</Link>
          <h1 className="text-2xl font-black text-white">{session.title}</h1>
          <p className="text-xs text-slate-400 mt-1">{new Date(session.started_at).toLocaleString()} · {meta.captionCount} captions · {mmss(summary.stats.durationMs)} · {summary.stats.words} words{summary.stats.wordsPerMinute ? ` · ${summary.stats.wordsPerMinute} words/min` : ''} · {totalRequests} student requests</p>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Download transcript">
          {['txt', 'srt', 'vtt', 'json'].map((f) => <Button key={f} variant="secondary" size="sm" onClick={() => download(f)}>⬇ {f.toUpperCase()}</Button>)}
          {isTeacher && <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>Delete</Button>}
        </div>
      </header>
      <div role="status" aria-live="polite" className="text-xs text-emerald-300 min-h-[1rem]">{notice}</div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 flex flex-col gap-4">
          <section className="p-5 rounded-xl bg-slate-900 border border-slate-800" aria-labelledby="auto-h">
            <h2 id="auto-h" className="text-sm font-bold text-slate-200">Automatic summary</h2>
            <p className="text-[11px] text-slate-400 mb-3">Made without AI by counting words and picking the most-discussed sentences.</p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {summary.keywords.length === 0 && <span className="text-xs text-slate-400 italic">Not enough speech to find key terms.</span>}
              {summary.keywords.map((k) => <button key={k.word} type="button" onClick={() => setSearch(k.word)} className="px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-xs font-semibold hover:bg-emerald-500/20">{k.word} ×{k.count}</button>)}
            </div>
            {summary.highlights.length > 0 && <ul className="text-xs text-slate-300 space-y-2">{summary.highlights.slice(0, 5).map((h, i) => <li key={i}><span className="text-slate-400 font-mono">{mmss(h.t_ms)}</span> {h.text}</li>)}</ul>}
          </section>

          {confusing.length > 0 && (
            <section className="p-5 rounded-xl bg-slate-900 border border-amber-500/30" aria-labelledby="conf-h">
              <h2 id="conf-h" className="text-sm font-bold text-amber-300 mb-2">❓ Moments students found confusing</h2>
              <ul className="text-xs text-slate-300 space-y-2">{confusing.map((c) => <li key={c.id}><span className="text-slate-400 font-mono">{mmss(c.t_ms)}</span> · {c.n} student{c.n > 1 ? 's' : ''} · {c.text}</li>)}</ul>
            </section>
          )}

          <section className="p-5 rounded-xl bg-slate-900 border border-slate-800" aria-labelledby="ai-h">
            <div className="flex items-center justify-between mb-2">
              <h2 id="ai-h" className="text-sm font-bold text-slate-200">Study notes</h2>
              {a && isTeacher && meta.ai.available && <Button variant="ghost" size="sm" onClick={() => setConsentOpen(true)}>Regenerate</Button>}
            </div>
            <div aria-live="polite">
              {ai.state === 'loading' && <LoadingIndicator text="Generating study notes… up to 30 seconds." />}
              {ai.error && <p role="alert" className="text-xs text-rose-300 mb-2">{ai.error}</p>}
              {a && ai.state !== 'loading' && (
                <div className="flex flex-col gap-3">
                  <p className="text-[11px] text-purple-300">✦ AI-generated · {new Date(a.generatedAt).toLocaleString()} · may contain mistakes — check against the transcript.{a.truncated ? ' Only the first part of this long lecture was summarised.' : ''}</p>
                  <p className="text-sm text-slate-200">{a.summary}</p>
                  <div><h3 className="text-xs font-bold text-slate-300 mb-1">Main concepts</h3><List items={a.concepts} /></div>
                  <div><h3 className="text-xs font-bold text-slate-300 mb-1">Key points</h3><List items={a.keyPoints} /></div>
                  <div><h3 className="text-xs font-bold text-slate-300 mb-1">Important terms</h3>{a.terms?.length ? <dl className="text-sm">{a.terms.map((t) => <div key={t.term} className="mb-1"><dt className="font-semibold inline">{t.term}: </dt><dd className="inline text-slate-300">{t.meaning}</dd></div>)}</dl> : <p className="text-xs text-slate-400">None found.</p>}</div>
                  <div><h3 className="text-xs font-bold text-slate-300 mb-1">Revision questions</h3><List items={a.questions} ordered /></div>
                  {a.actionItems?.length > 0 && <div><h3 className="text-xs font-bold text-slate-300 mb-1">Tasks mentioned</h3><List items={a.actionItems} /></div>}
                  {a.notes && <div><h3 className="text-xs font-bold text-slate-300 mb-1">Study notes</h3><p className="text-sm whitespace-pre-wrap text-slate-300">{a.notes}</p></div>}
                </div>
              )}
              {!a && ai.state !== 'loading' && (
                !meta.ai.available ? <p className="text-xs text-slate-400">AI study notes are not turned on for this server (set AI_PROVIDER, AI_API_KEY and AI_MODEL). The automatic summary above works without them.</p>
                : isTeacher ? <><p className="text-xs text-slate-400 mb-3">Create a summary, key terms and revision questions. The teacher’s captions are sent to an external AI service; student messages are not.</p><Button onClick={() => setConsentOpen(true)}>✦ Generate study notes</Button></>
                : <p className="text-xs text-slate-400">Your teacher has not generated study notes for this lecture.</p>
              )}
            </div>
          </section>
        </div>

        <section className="lg:col-span-2 flex flex-col gap-3" aria-labelledby="full-h">
          <h2 id="full-h" className="sr-only">Full transcript</h2>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[12rem]"><label htmlFor="tr-search" className="sr-only">Search this transcript</label>
              <input id="tr-search" type="search" value={search} maxLength={80} onChange={(e) => setSearch(e.target.value)} placeholder="Search this transcript…" className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100" /></div>
            <label className="text-xs text-slate-300 flex items-center gap-1.5"><input type="checkbox" checked={onlyConfusing} onChange={(e) => setOnlyConfusing(e.target.checked)} /> Only confusing lines</label>
          </div>
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 max-h-[70vh] overflow-y-auto space-y-2" aria-live="polite">
            {listLoading && items.length === 0 ? <LoadingIndicator text="Loading captions…" />
              : rows.length === 0 ? <EmptyState title={search ? 'No lines match' : 'No captions were recorded'} description={search ? 'Try a different word.' : 'This lecture has no saved captions.'} />
              : rows.map((c) => (
                <div key={c.id} className={`p-3 rounded-xl bg-slate-900 border ${flags[c.id]?.confusing ? 'border-amber-500/50' : 'border-slate-800'}`}>
                  <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                    <span className="font-semibold text-emerald-400">{c.source === 'sign' ? '🤟 ' : c.source === 'student' ? '✍️ ' : ''}{c.speaker}{flags[c.id]?.confusing ? <span className="ml-2 text-amber-300">❓ {flags[c.id].confusing}</span> : null}</span>
                    <time className="font-mono">{mmss(c.t_ms)}</time>
                  </div>
                  <p className="text-sm text-slate-200 leading-relaxed"><Highlight text={c.text} term={search.trim()} /></p>
                </div>
              ))}
            {next && <div className="text-center pt-2"><Button variant="secondary" size="sm" loading={listLoading} onClick={() => loadCaptions(true, next)}>Load more</Button></div>}
          </div>
        </section>
      </div>

      <Modal isOpen={consentOpen} onClose={() => { setConsentOpen(false); setAgree(false); }} title="Send this transcript to an AI service?">
        <p className="text-sm text-slate-300 mb-3">The teacher’s captions from this lecture will be sent to the AI provider your school configured. Student messages are not included. The result is saved with the lecture and labelled AI-generated.</p>
        <label className="flex items-start gap-2 text-sm mb-4"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" /> I agree to send this transcript for summarising.</label>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => { setConsentOpen(false); setAgree(false); }}>Cancel</Button><Button disabled={!agree} onClick={() => generate(Boolean(a))}>Generate</Button></div>
      </Modal>
      <Modal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete this lecture?">
        <p className="text-sm text-slate-300 mb-4">The transcript, flags and study notes are permanently deleted.</p>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancel</Button><Button variant="danger" onClick={deleteLecture}>Delete lecture</Button></div>
      </Modal>
    </div>
  );
}
