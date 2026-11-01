import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../services/api';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/Input';
import { Modal } from '../components/common/Modal';

export function AccountPage() {
  const { user, logout, replaceToken } = useAuth();
  const navigate = useNavigate();
  const [pw, setPw] = useState({ current: '', next: '' });
  const [msg, setMsg] = useState({ kind: '', text: '' });
  const [busy, setBusy] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  const [delPw, setDelPw] = useState('');

  async function changePassword(e) {
    e.preventDefault();
    if (pw.next.length < 6) { setMsg({ kind: 'error', text: 'The new password must be at least 6 characters.' }); return; }
    setBusy(true); setMsg({ kind: '', text: '' });
    try { const r = await api.changePassword(pw.current, pw.next); replaceToken(r.token); setPw({ current: '', next: '' }); setMsg({ kind: 'ok', text: 'Password changed. Other devices were signed out.' }); }
    catch (err) { setMsg({ kind: 'error', text: err.message }); } finally { setBusy(false); }
  }
  async function signOutEverywhere() {
    try { await api.logoutAll(); } catch { /* the token may already be invalid */ }
    logout(); navigate('/login');
  }
  async function deleteAccount(e) {
    e.preventDefault(); setBusy(true);
    try { await api.deleteAccount(delPw); logout(); navigate('/login'); }
    catch (err) { setMsg({ kind: 'error', text: err.message }); setDelOpen(false); } finally { setBusy(false); }
  }

  return (
    <div className="max-w-xl mx-auto flex flex-col gap-6">
      <h1 className="text-2xl font-black text-white">Account</h1>
      <p className="text-sm text-slate-300">{user.name} · {user.email} · {user.role}</p>
      {msg.text && <p role={msg.kind === 'error' ? 'alert' : 'status'} className={`text-sm ${msg.kind === 'error' ? 'text-rose-300' : 'text-emerald-300'}`}>{msg.text}</p>}

      <form onSubmit={changePassword} className="p-5 rounded-xl bg-slate-900 border border-slate-800 flex flex-col gap-3" noValidate>
        <h2 className="text-sm font-bold">Change password</h2>
        <Input label="Current password" type="password" name="current" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
        <Input label="New password" type="password" name="new" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} helperText="At least 6 characters." />
        <Button type="submit" loading={busy}>Change password</Button>
      </form>

      <section className="p-5 rounded-xl bg-slate-900 border border-slate-800">
        <h2 className="text-sm font-bold mb-1">Sign out everywhere</h2>
        <p className="text-xs text-slate-400 mb-3">Ends your session on every device, including this one.</p>
        <Button variant="secondary" onClick={signOutEverywhere}>Sign out of all devices</Button>
      </section>

      <section className="p-5 rounded-xl bg-rose-500/5 border border-rose-500/30">
        <h2 className="text-sm font-bold text-rose-300 mb-1">Delete my account</h2>
        <p className="text-xs text-slate-400 mb-3">Your messages stay in transcripts as “Deleted user”. Teachers must delete their classrooms first.</p>
        <Button variant="danger" onClick={() => { setDelPw(''); setDelOpen(true); }}>Delete account</Button>
      </section>

      <Modal isOpen={delOpen} onClose={() => setDelOpen(false)} title="Delete your account?">
        <form onSubmit={deleteAccount} className="flex flex-col gap-3">
          <Input label="Enter your password to confirm" type="password" name="delpw" autoComplete="current-password" value={delPw} onChange={(e) => setDelPw(e.target.value)} />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDelOpen(false)}>Cancel</Button><Button type="submit" variant="danger" loading={busy} disabled={!delPw}>Delete account</Button></div>
        </form>
      </Modal>
    </div>
  );
}
