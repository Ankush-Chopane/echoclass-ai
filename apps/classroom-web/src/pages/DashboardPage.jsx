import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../services/api';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Modal } from '../components/common/Modal';
import { StatusBadge, LoadingIndicator, EmptyState } from '../components/common/StatusBadge';
import { createClassroomSchema, joinClassroomSchema } from '../schemas/classroom.schema';
import { SUPPORTED_LANGUAGES } from '@echoclass/shared/constants';

export function DashboardPage() {
  const { user, isTeacher } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [network, setNetwork] = useState(null);
  const [modal, setModal] = useState(null);            // 'create' | 'join' | null
  const [form, setForm] = useState({ name: '', subject: '', language: 'en-IN', code: '' });
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.getDashboard()); setError(''); }
    catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  // LAN address of this server, for the teacher to give to students on the same Wi-Fi (teacher-only endpoint).
  useEffect(() => { if (isTeacher) api.getNetwork().then(setNetwork).catch(() => {}); }, [isTeacher]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const open = (m) => { setForm({ name: '', subject: '', language: 'en-IN', code: '' }); setFormError(''); setModal(m); };

  async function submit(e) {
    e.preventDefault();
    const schema = modal === 'create' ? createClassroomSchema : joinClassroomSchema;
    const parsed = schema.safeParse(modal === 'create' ? { name: form.name, subject: form.subject } : { code: form.code });
    if (!parsed.success) { setFormError(parsed.error.issues[0].message); return; }
    setBusy(true); setFormError('');
    try {
      if (modal === 'create') await api.createClassroom({ name: parsed.data.name, subject: parsed.data.subject || '', language: form.language });
      else await api.joinClassroom(parsed.data.code);
      setModal(null); await load();
    } catch (err) { setFormError(err.message); } finally { setBusy(false); }
  }

  const classrooms = data?.classrooms || [];
  const lanUrl = network?.localIps?.[0] ? `${network.https ? 'https' : 'http'}://${network.localIps[0]}:${network.https ? network.httpsPort : network.port}` : null;

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900 to-emerald-950/40 border border-slate-800">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <h1 className="text-2xl font-black text-white">Welcome, {user.name}</h1>
            <StatusBadge status={user.role} label={user.role} />
          </div>
          <p className="text-sm text-slate-400">{isTeacher ? 'Create classrooms, caption your lectures live, and review transcripts.' : 'Join a class with your teacher’s code, read live captions, and respond with signs, phrases or typing.'}</p>
        </div>
        <Button onClick={() => open(isTeacher ? 'create' : 'join')} className="font-bold">{isTeacher ? '+ Create classroom' : 'Join with code'}</Button>
      </header>

      {isTeacher && data?.totals && (
        <dl className="grid grid-cols-3 gap-3 text-center">
          {[['Classrooms', data.totals.classrooms], ['Students', data.totals.students], ['Lectures saved', data.totals.lectures]].map(([l, n]) => (
            <div key={l} className="p-4 rounded-xl bg-slate-900 border border-slate-800"><dd className="text-2xl font-black text-white">{n}</dd><dt className="text-xs text-slate-400">{l}</dt></div>
          ))}
        </dl>
      )}

      {lanUrl && (
        <p className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300">
          📶 <strong>Students on the same Wi-Fi can open:</strong> <code className="text-emerald-300 font-mono bg-slate-950 px-2 py-0.5 rounded">{lanUrl}</code>
          {network.speechEngine?.ready && <span className="ml-3 text-emerald-400">● Offline speech engine ready</span>}
        </p>
      )}

      {data?.live?.length > 0 && (
        <section aria-label="Live now" className="flex flex-col gap-2">
          {data.live.map((l) => (
            <div key={l.session_id} role="status" className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-500/30 flex items-center justify-between gap-3">
              <span><StatusBadge status="live" label="LIVE" /> <strong className="ml-2">{l.name}</strong> is in progress</span>
              <Link to={`/classrooms/${l.classroom_id}/live`}><Button size="sm">Enter</Button></Link>
            </div>
          ))}
        </section>
      )}

      {error ? <div role="alert" className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error} <button type="button" className="underline ml-2" onClick={load}>Retry</button></div>
        : !data ? <LoadingIndicator text="Loading your classrooms…" />
        : classrooms.length === 0 ? (
          <EmptyState title={isTeacher ? 'No classrooms yet' : 'You have not joined a classroom'} description={isTeacher ? 'Create your first classroom, then share its join code with students.' : 'Ask your teacher for the 8-character join code.'}
            action={<Button onClick={() => open(isTeacher ? 'create' : 'join')}>{isTeacher ? 'Create classroom' : 'Join classroom'}</Button>} />
        ) : (
          <section aria-label="Your classrooms" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {classrooms.map((c) => (
              <article key={c.id} className="flex flex-col justify-between bg-slate-900/90 border border-slate-800 rounded-2xl p-6">
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h2 className="text-lg font-bold text-white">{c.name}</h2>
                    {c.live && <StatusBadge status="live" label="LIVE" />}
                  </div>
                  <p className="text-xs text-slate-400 mb-4">{c.subject ? `${c.subject} · ` : ''}{isTeacher ? `${c.students} student${c.students === 1 ? '' : 's'}` : `Teacher: ${c.teacher_name}`} · {c.lectures} lecture{c.lectures === 1 ? '' : 's'} saved</p>
                  {isTeacher && <span className="font-mono bg-slate-800 text-emerald-300 px-2 py-0.5 rounded text-xs font-bold">Code: {c.code}</span>}
                </div>
                <div className="flex gap-2 pt-4 mt-4 border-t border-slate-800/80">
                  <Link to={`/classrooms/${c.id}`} className="flex-1"><Button variant="secondary" size="sm" className="w-full">Open</Button></Link>
                  {c.live && <Link to={`/classrooms/${c.id}/live`} className="flex-1"><Button size="sm" className="w-full font-bold">Enter live 🎙️</Button></Link>}
                </div>
              </article>
            ))}
          </section>
        )}

      {data?.recent?.length > 0 && (
        <section aria-labelledby="recent-h">
          <h2 id="recent-h" className="text-sm font-bold uppercase tracking-wider text-slate-300 mb-3">Recent lectures</h2>
          <ul className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900">
            {data.recent.map((r) => (
              <li key={r.id} className="p-3 flex items-center justify-between gap-3 text-sm">
                <span><Link to={`/transcripts/${r.id}`} className="font-semibold text-emerald-300 hover:underline">{r.title}</Link> <span className="text-xs text-slate-400">· {r.classroom_name} · {new Date(r.started_at).toLocaleDateString()} · {r.captions} captions</span></span>
                {r.has_ai ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">AI notes</span> : null}
              </li>
            ))}
          </ul>
        </section>
      )}

      <Modal isOpen={modal === 'create'} onClose={() => setModal(null)} title="Create a classroom">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Input label="Classroom name" name="name" value={form.name} onChange={set('name')} placeholder="e.g. Class 9-B Biology" maxLength={80} autoFocus />
          <Input label="Subject (optional)" name="subject" value={form.subject} onChange={set('subject')} maxLength={80} />
          <div><label htmlFor="c-lang" className="text-xs font-semibold uppercase tracking-wider text-slate-300 block mb-1.5">Teaching language</label>
            <select id="c-lang" value={form.language} onChange={set('language')} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2 text-sm">{SUPPORTED_LANGUAGES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></div>
          {formError && <p role="alert" className="text-sm text-rose-400">{formError}</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button><Button type="submit" loading={busy}>Create</Button></div>
        </form>
      </Modal>
      <Modal isOpen={modal === 'join'} onClose={() => setModal(null)} title="Join a classroom">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Input label="Join code from your teacher" name="code" value={form.code} onChange={set('code')} placeholder="e.g. K7M2QX4P" maxLength={10} autoComplete="off" autoFocus />
          {formError && <p role="alert" className="text-sm text-rose-400">{formError}</p>}
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setModal(null)}>Cancel</Button><Button type="submit" loading={busy}>Join</Button></div>
        </form>
      </Modal>
    </div>
  );
}
