import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { loginSchema } from '../schemas/auth.schema';
import { Input } from '../components/common/Input';
import { Button } from '../components/common/Button';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [loading, setLoading] = useState(false);

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
    const result = loginSchema.safeParse(formData);
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
      await login(formData.email, formData.password);
      navigate('/dashboard');
    } catch (err) {
      setServerError(err.message || 'Login failed. Please verify your credentials.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex justify-center items-center py-12 px-4">
      <div className="w-full max-w-md bg-slate-900/90 border border-slate-800 rounded-2xl p-8 shadow-2xl backdrop-blur-sm">
        <div className="text-center mb-8">
          <span className="w-12 h-12 rounded-xl bg-emerald-700 inline-flex items-center justify-center font-black text-white text-2xl shadow-lg shadow-emerald-900/30 mb-3">
            E
          </span>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">Sign in to EchoClass</h1>
          <p className="text-sm text-slate-400 mt-1">Access your classrooms, live captions, and transcripts</p>
        </div>

        {serverError && (
          <div className="mb-6 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm font-medium flex items-center gap-2">
            <span>⚠️</span>
            <span>{serverError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Input
            label="Email Address"
            name="email"
            type="email"
            placeholder="student@example.com"
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
            placeholder="••••••••"
            value={formData.password}
            onChange={handleChange}
            error={errors.password}
            required
            autoComplete="current-password"
          />

          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full mt-2 font-bold">
            Sign In
          </Button>
        </form>

        <div className="mt-6 pt-6 border-t border-slate-800 text-center text-sm text-slate-400">
          New to EchoClass?{' '}
          <Link to="/register" className="text-emerald-400 font-semibold hover:underline">
            Create an account
          </Link>
        </div>
      </div>
    </div>
  );
}
