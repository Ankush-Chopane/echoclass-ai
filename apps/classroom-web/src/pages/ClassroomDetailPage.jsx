import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../services/api';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Modal } from '../components/common/Modal';
import { StatusBadge, LoadingIndicator, EmptyState } from '../components/common/StatusBadge';
import { vocabSchema, createSessionSchema } from '../schemas/classroom.schema';

const TABS = (teacher) => [['lectures', 'Lectures'], ...(teacher ? [['vocab', 'Vocabulary'], ['students', 'Students'], ['settings', 'Settings']] : [])];
const when = (ms) => new Date(ms).toLocaleString();

export function ClassroomDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isTeacher } = useAuth();

  const [cls, setCls] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('lectures');
  const [message, setMessage] = useState('');

  // lectures (server-side paging + search)
  const [lectures, setLectures] = useState({ items: [], total: 0, page: 1, pages: 1 });
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [lecturesLoading, setLecturesLoading] = useState(false);

  // dialogs / forms
  const [startOpen, setStartOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [heard, setHeard] = useState('');
  const [replacement, setReplacement] = useState('');
  const [confirm, setConfirm] = useState(null);       // { title, text, label, run }
  const [retention, setRetention] = useState('0');

  const loadClass = useCallback(async () => {
    try {
      const data = await api.getClassroom(id);
      setCls(data); setRetention(String(data.retention_days || 0)); setError('');
    } catch (e) { setError(e.message); }
  }, [id]);
  useEffect(() => { loadClass(); }, [loadClass]);

  const loadLectures = useCallback(async () => {
    setLecturesLoading(true);
    try { setLectures(await api.listSessions(id, { page, q: query })); }
    catch (e) { setMessage(e.message); }
    finally { setLecturesLoading(false); }
  }, [id, page, query]);
  useEffect(() => { const t = setTimeout(loadLectures, query ? 300 : 0); return () => clearTimeout(t); }, [loadLectures, query]);

  async function startLecture(e) {
    e.preventDefault();
    const parsed = createSessionSchema.safeParse({ title: title.trim() || `${cls.name} lecture` });
    if (!parsed.success) { setFormError(parsed.error.issues[0].message); return; }
    setBusy(true); setFormError('');
    try { await api.startSession(id, parsed.data.title); navigate(`/classrooms/${id}/live`); }
    catch (err) { setFormError(err.message); } finally { setBusy(false); }
  }
  async function addVocab(e) {
    e.preventDefault();
    const parsed = vocabSchema.safeParse({ heard, replacement });
    if (!parsed.success) { setFormError(parsed.error.issues[0].message); return; }
    setBusy(true); setFormError('');
    try { const vocab = await api.addVocab(id, parsed.data.heard, parsed.data.replacement); setCls((c) => ({ ...c, vocab })); setHeard(''); setReplacement(''); }
    catch (err) { setFormError(err.message); } finally { setBusy(false); }
  }
  async function removeVocab(v) {
    try { const vocab = await api.deleteVocab(id, v.id); setCls((c) => ({ ...c, vocab })); } catch (err) { setMessage(err.message); }
  }
  const ask = (opts) => setConfirm(opts);
  async function runConfirm() {
    setBusy(true);
    try { await confirm.run(); setConfirm(null); } catch (err) { setMessage(err.message); setConfirm(null); } finally { setBusy(false); }
  }
  const rotate = () => ask({ title: 'Change the join code?', text: 'The current code stops working immediately. Students already in the class stay enrolled.', label: 'Change code', run: async () => { const r = await api.rotateJoinCode(id); setCls((c) => ({ ...c, code: r.code })); setMessage('Join code changed.'); } });
  const removeStudent = (s) => ask({ title: `Remove ${s.name}?`, text: 'They lose access to this class and its transcripts until they join again with the code.', label: 'Remove', run: async () => { await api.removeStudent(id, s.id); await loadClass(); } });
  const deleteLecture = (l) => ask({ title: 'Delete this lecture?', text: `“${l.title}” and its transcript, flags and study notes are permanently deleted.`, label: 'Delete lecture', run: async () => { await api.deleteSession(l.id); await Promise.all([loadClass(), loadLectures()]); } });
  const deleteClass = () => ask({ title: `Delete “${cls.name}”?`, text: 'Every lecture and transcript in this classroom is permanently deleted.', label: 'Delete classroom', run: async () => { await api.deleteClassroom(id); navigate('/dashboard'); } });
  const leaveClass = () => ask({ title: 'Leave this class?', text: 'You can join again later with the code.', label: 'Leave class', run: async () => { await api.leaveClassroom(id); navigate('/dashboard'); } });
  async function saveRetention() {
    try { const u = await api.updateClassroom(id, { retention_days: Number(retention) || null }); setCls((c) => ({ ...c, ...u })); setMessage('Retention saved.'); } catch (err) { setMessage(err.message); }
  }

  if (error) return <div role="alert" className="p-6 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300">{error} <Link to="/dashboard" className="underline ml-2">Back to dashboard</Link></div>;
  if (!cls) return <LoadingIndicator text="Loading classroom…" />;

  const live = cls.live;
  const tabs = TABS(isTeacher);

  return (
    <div className="flex flex-col gap-6">
      <header className="p-6 rounded-2xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <Link to="/dashboard" className="text-xs text-slate-400 hover:text-white">← Dashboard</Link>
          <h1 className="text-2xl font-black text-white">{cls.name}</h1>
          <p className="text-xs text-slate-400 mt-1">{cls.subject ? `${cls.subject} · ` : ''}Teacher: {cls.teacher_name} · Created {new Date(cls.created_at).toLocaleDateString()}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isTeacher && (
            <div className="flex items-center gap-2 bg-slate-950 border border-slate-800 px-3 py-1.5 rounded-xl text-xs">
              <span className="text-slate-400">Join code:</span>
              <code className="text-emerald-400 font-mono font-bold text-sm tracking-wider" aria-label={`Join code ${cls.code.split('').join(' ')}`}>{cls.code}</code>
              <button type="button" onClick={rotate} className="text-slate-400 hover:text-white" aria-label="Change join code" title="Change join code">🔄</button>
            </div>
          )}
          {live ? (
            <Link to={`/classrooms/${id}/live`}><Button className="font-bold">{isTeacher ? 'Resume live lecture' : 'Join live lecture'} 🎙️</Button></Link>
          ) : isTeacher ? (
            <Button onClick={() => { setTitle(''); setFormError(''); setStartOpen(true); }} className="font-bold">+ Start lecture</Button>
          ) : <StatusBadge status="ended" label="No lecture right now" />}
        </div>
      </header>

      {message && <div role="status" className="p-3 rounded-lg border border-slate-700 bg-slate-900 text-sm text-slate-200 flex justify-between"><span>{message}</span><button type="button" onClick={() => setMessage('')} aria-label="Dismiss message">✕</button></div>}

      <div role="tablist" aria-label="Classroom sections" className="flex items-center gap-4 border-b border-slate-800">
        {tabs.map(([key, label]) => (
          <button key={key} role="tab" id={`tab-${key}`} aria-selected={tab === key} aria-controls={`panel-${key}`} onClick={() => { setTab(key); setFormError(''); }}
            className={`pb-3 text-sm font-bold border-b-2 ${tab === key ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400 hover:text-slate-200'}`}>
            {label}{key === 'vocab' ? ` (${cls.vocab?.length || 0})` : key === 'students' ? ` (${cls.roster?.length || 0})` : ''}
          </button>
        ))}
      </div>

      {tab === 'lectures' && (
        <div role="tabpanel" id="panel-lectures" aria-labelledby="tab-lectures" className="flex flex-col gap-3">
          <div>
            <label htmlFor="lec-q" className="sr-only">Search lectures</label>
            <input id="lec-q" type="search" value={query} onChange={(e) => { setPage(1); setQuery(e.target.value); }} placeholder="Search lecture titles and what was said…" maxLength={80} className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100" />
          </div>
          {lecturesLoading && lectures.items.length === 0 ? <LoadingIndicator text="Loading lectures…" /> : lectures.items.length === 0 ? (
            <EmptyState title={query ? 'No lectures match your search' : 'No lectures yet'} description={query ? 'Try a different word.' : isTeacher ? 'Start a lecture to begin captioning.' : 'Lectures appear here after your teacher teaches.'} />
          ) : lectures.items.map((l) => (
            <article key={l.id} className="p-5 rounded-xl bg-slate-900 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-bold text-slate-100 flex items-center gap-2 text-base">{l.title} {!l.ended_at && <StatusBadge status="live" label="LIVE" />}{l.has_ai ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">AI notes</span> : null}</h2>
                <p className="text-xs text-slate-400 mt-0.5">{when(l.started_at)} · {l.captions} captions</p>
              </div>
              <div className="flex items-center gap-2">
                {l.ended_at ? <Link to={`/transcripts/${l.id}`}><Button variant="secondary" size="sm">Transcript</Button></Link> : <Link to={`/classrooms/${id}/live`}><Button size="sm">Enter live class</Button></Link>}
                {isTeacher && l.ended_at && <Button variant="ghost" size="sm" onClick={() => deleteLecture(l)} aria-label={`Delete lecture ${l.title}`}>🗑</Button>}
              </div>
            </article>
          ))}
          {lectures.pages > 1 && (
            <nav aria-label="Lecture pages" className="flex items-center justify-center gap-3 text-sm">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Newer</Button>
              <span>Page {lectures.page} of {lectures.pages}</span>
              <Button variant="secondary" size="sm" disabled={page >= lectures.pages} onClick={() => setPage(page + 1)}>Older →</Button>
            </nav>
          )}
        </div>
      )}

      {tab === 'vocab' && isTeacher && (
        <div role="tabpanel" id="panel-vocab" aria-labelledby="tab-vocab" className="flex flex-col gap-6">
          <form onSubmit={addVocab} className="p-5 rounded-xl bg-slate-900 border border-slate-800" noValidate>
            <h2 className="text-sm font-bold text-slate-200 mb-1">Add a speech correction</h2>
            <p className="text-xs text-slate-400 mb-4">Speech engines mishear subject words. Each rule replaces what was heard with the right word in live captions and transcripts (whole words only, not case-sensitive).</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Input label="Heard as" name="heard" value={heard} onChange={(e) => setHeard(e.target.value)} placeholder="might a conjure" maxLength={60} />
              <Input label="Should be" name="replacement" value={replacement} onChange={(e) => setReplacement(e.target.value)} placeholder="mitochondria" maxLength={80} />
              <Button type="submit" loading={busy} className="shrink-0 self-end">Add rule</Button>
            </div>
            {formError && <p role="alert" className="text-xs text-rose-400 mt-2">{formError}</p>}
          </form>
          {cls.vocab.length === 0 ? <EmptyState title="No corrections yet" description="Add words your class often says that the microphone gets wrong." /> : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {cls.vocab.map((v) => (
                <li key={v.id} className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800 flex items-center justify-between text-sm">
                  <span><span className="line-through text-slate-400">{v.heard}</span> <span aria-label="becomes">→</span> <b className="text-emerald-400">{v.replacement}</b></span>
                  <button type="button" onClick={() => removeVocab(v)} aria-label={`Delete correction ${v.heard}`} className="text-slate-400 hover:text-rose-400 px-2">✕</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'students' && isTeacher && (
        <div role="tabpanel" id="panel-students" aria-labelledby="tab-students">
          {cls.roster.length === 0 ? <EmptyState title="No students yet" description={`Give your students the join code ${cls.code}.`} /> : (
            <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900">
              {cls.roster.map((s) => (
                <li key={s.id} className="p-3 flex items-center justify-between text-sm">
                  <span><b>{s.name}</b> <span className="text-slate-400 text-xs">{s.email} · joined {new Date(s.joined_at).toLocaleDateString()}</span></span>
                  <Button variant="ghost" size="sm" onClick={() => removeStudent(s)} aria-label={`Remove ${s.name}`}>Remove</Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'settings' && isTeacher && (
        <div role="tabpanel" id="panel-settings" aria-labelledby="tab-settings" className="flex flex-col gap-6 max-w-xl">
          <section className="p-5 rounded-xl bg-slate-900 border border-slate-800">
            <h2 className="text-sm font-bold mb-1">Keep transcripts for</h2>
            <p className="text-xs text-slate-400 mb-3">Ended lectures older than this are deleted automatically. “Until I delete them” keeps everything.</p>
            <div className="flex gap-2 items-end">
              <div className="flex-1"><label htmlFor="ret" className="sr-only">Retention</label>
                <select id="ret" value={retention} onChange={(e) => setRetention(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-sm">
                  <option value="0">Until I delete them</option><option value="30">30 days</option><option value="90">90 days</option><option value="180">180 days</option><option value="365">1 year</option>
                </select></div>
              <Button onClick={saveRetention}>Save</Button>
            </div>
          </section>
          <section className="p-5 rounded-xl bg-rose-500/5 border border-rose-500/30">
            <h2 className="text-sm font-bold text-rose-300 mb-1">Delete classroom</h2>
            <p className="text-xs text-slate-400 mb-3">Permanently deletes this classroom with all lectures and transcripts.</p>
            <Button variant="danger" onClick={deleteClass}>Delete classroom</Button>
          </section>
        </div>
      )}

      {!isTeacher && <div><Button variant="ghost" size="sm" onClick={leaveClass}>Leave this class</Button></div>}

      <Modal isOpen={startOpen} onClose={() => setStartOpen(false)} title="Start a lecture">
        <form onSubmit={startLecture} className="flex flex-col gap-4" noValidate>
          <Input label="Lecture title" name="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Photosynthesis" maxLength={80} autoFocus />
          {formError && <p role="alert" className="text-xs text-rose-400">{formError}</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setStartOpen(false)}>Cancel</Button><Button type="submit" loading={busy}>Start 🎙️</Button></div>
        </form>
      </Modal>
      <Modal isOpen={Boolean(confirm)} onClose={() => setConfirm(null)} title={confirm?.title || ''}>
        <p className="text-sm text-slate-300 mb-4">{confirm?.text}</p>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button><Button variant="danger" onClick={runConfirm} loading={busy}>{confirm?.label}</Button></div>
      </Modal>
    </div>
  );
}
