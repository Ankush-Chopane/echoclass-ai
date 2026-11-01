import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { registerSchema } from '../schemas/auth.schema';
import { Input } from '../components/common/Input';
import { Button } from '../components/common/Button';
import { api } from '../services/api';

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    role: 'student',
    inviteCode: ''
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);
  const [cfg, setCfg] = useState(null);
  useEffect(() => { api.getConfig().then(setCfg).catch(() => {}); }, []);   // does this server require a teacher invite code?

  function handleChange(e) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setServerError('');

    // Zod validation
    const result = registerSchema.safeParse(formData);
    if (!result.success) {
      const fieldErrors = {};
      result.error.issues.forEach((err) => {
        fieldErrors[err.path[0]] = err.message;
      });
      setErrors(fieldErrors);
      return;
    }

    setLoading(true);
    try {
      await register(formData);
      navigate('/dashboard');
    } catch (err) {
      setErrors((prev) => ({ ...prev, ...err.fields }));            // the server's per-field messages (e.g. email already registered)
      setServerError(err.message || 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex justify-center items-center py-10 px-4">
      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-2xl p-8 shadow-2xl backdrop-blur-sm">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Create your account</h1>
          <p className="text-sm text-slate-400 mt-1">Join the accessible classroom community</p>
        </div>

        {serverError && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm font-medium flex items-center gap-2">
            <span>⚠️</span>
            <span>{serverError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <Input
            label="Full Name"
            name="name"
            placeholder="Alex Rivera"
            value={formData.name}
            onChange={handleChange}
            error={errors.name}
            required
            autoComplete="name"
          />

          <Input
            label="Email Address"
            name="email"
            type="email"
            placeholder="alex@university.edu"
            value={formData.email}
            onChange={handleChange}
            error={errors.email}
            required
            autoComplete="email"
          />

          <Input
            label="Password"
            name="password"
            type="password"
            placeholder="At least 6 characters"
            value={formData.password}
            onChange={handleChange}
            error={errors.password}
            required
            autoComplete="new-password"
          />

          {/* Role selection */}
          <div className="flex flex-col gap-1.5 text-left">
            <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
              I am a <span className="text-rose-400">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: 'student', label: 'Student', desc: 'Join classes & read captions' },
                { id: 'teacher', label: 'Teacher', desc: 'Create classes & speak' }
              ].map((r) => (
                <button
                  type="button"
                  key={r.id}
                  aria-pressed={formData.role === r.id}
                  onClick={() => setFormData((p) => ({ ...p, role: r.id }))}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    formData.role === r.id
                      ? 'border-emerald-500 bg-emerald-500/10 font-bold'
                      : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                  }`}
                >
                  <div className="text-sm text-slate-100">{r.label}</div>
                  <div className="text-xs text-slate-400 font-normal">{r.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {formData.role === 'teacher' && (
            <Input
              label={cfg?.teacherInviteRequired ? 'Teacher invite code' : 'Teacher invite code (optional)'}
              name="inviteCode"
              required={Boolean(cfg?.teacherInviteRequired)}
              autoComplete="off"
              placeholder={cfg?.teacherInviteRequired ? 'Ask your school administrator' : 'Leave blank if sign-up is open'}
              value={formData.inviteCode}
              onChange={handleChange}
              error={errors.inviteCode}
            />
          )}

          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full mt-2 font-bold">
            Create Account
          </Button>
        </form>

        <div className="mt-6 pt-6 border-t border-slate-800 text-center text-sm text-slate-400">
          Already registered?{' '}
          <Link to="/login" className="text-emerald-400 font-semibold hover:underline">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
