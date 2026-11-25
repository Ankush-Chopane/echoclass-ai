import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useAccessibility } from '../../hooks/useAccessibility';
import { Modal } from './Modal';
import { Button } from './Button';
import { StatusBadge } from './StatusBadge';

export function Navbar() {
  const { user, isAuthenticated, logout } = useAuth();
  const { theme, setTheme, captionSize, setCaptionSize, fontFamily, setFontFamily, focusMode, toggleFocusMode } = useAccessibility();
  const [isA11yOpen, setIsA11yOpen] = useState(false);
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  if (focusMode) {
    return (
      <div className="fixed top-3 right-3 z-50">
        <Button variant="secondary" size="sm" onClick={toggleFocusMode}>
          Exit Focus Mode
        </Button>
      </div>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-40 w-full border-b border-slate-800 bg-slate-950/85 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2.5 group">
              <span className="w-8 h-8 rounded-lg bg-emerald-700 flex items-center justify-center font-black text-white text-base shadow-sm group-hover:bg-emerald-500 transition-colors">
                E
              </span>
              <span className="font-extrabold text-lg tracking-tight text-white flex items-center gap-1.5">
                EchoClass <span className="text-emerald-400 font-medium text-xs px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/20">AI</span>
              </span>
            </Link>

            <nav aria-label="Main" className="hidden sm:flex items-center gap-4 text-sm font-medium">
              {isAuthenticated && <Link to="/dashboard" className="text-slate-300 hover:text-white transition-colors">Dashboard</Link>}
              <Link to="/demo" className="text-slate-400 hover:text-slate-200 transition-colors">Demo</Link>
              {isAuthenticated && <Link to="/account" className="text-slate-400 hover:text-slate-200 transition-colors">Account</Link>}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsA11yOpen(true)}
              className="p-2 text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition-colors flex items-center gap-1.5 text-xs font-semibold border border-slate-700/60"
              title="Accessibility & Theme Settings"
              aria-label="Open accessibility settings"
            >
              <span>♿</span>
              <span className="hidden sm:inline">Settings</span>
            </button>

            {isAuthenticated ? (
              <div className="flex items-center gap-3">
                <div className="hidden sm:flex flex-col text-right">
                  <span className="text-sm font-semibold text-slate-100">{user.name}</span>
                  <StatusBadge status={user.role} label={user.role} />
                </div>
                <Button variant="ghost" size="sm" onClick={handleLogout}>
                  Sign Out
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Link to="/login">
                  <Button variant="ghost" size="sm">Sign In</Button>
                </Link>
                <Link to="/register">
                  <Button variant="primary" size="sm">Register</Button>
                </Link>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Accessibility & Themes Modal */}
      <Modal
        isOpen={isA11yOpen}
        onClose={() => setIsA11yOpen(false)}
        title="Accessibility & Display Controls"
      >
        <div className="flex flex-col gap-5">
          {/* Theme selection */}
          <div>
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 block">
              Color Theme
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'dark', label: 'Dark Studio', desc: 'Sleek dark mode' },
                { id: 'high-contrast', label: 'High Contrast', desc: 'Yellow on black' },
                { id: 'light', label: 'Light Daylight', desc: 'Clean daylight' },
                { id: 'solarized', label: 'Solarized', desc: 'Warm sepia' }
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTheme(t.id)}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    theme === t.id
                      ? 'border-emerald-500 bg-emerald-500/10 font-bold'
                      : 'border-slate-800 bg-slate-800/40 hover:border-slate-700'
                  }`}
                >
                  <div className="text-sm text-slate-100">{t.label}</div>
                  <div className="text-xs text-slate-400">{t.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Caption Size */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Live Caption Size
              </label>
              <span className="text-sm font-bold text-emerald-400">{captionSize}px</span>
            </div>
            <input
              type="range"
              min="18"
              max="64"
              step="2"
              value={captionSize}
              onChange={(e) => setCaptionSize(Number(e.target.value))}
              className="w-full accent-emerald-500"
            />
            <div className="mt-2 p-3 bg-slate-950 rounded-lg border border-slate-800 text-center">
              <span style={{ fontSize: `${captionSize}px`, lineHeight: 1.3 }} className="font-semibold">
                Sample live caption preview
              </span>
            </div>
          </div>

          {/* Focus Mode */}
          <div className="pt-2 border-t border-slate-800 flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-slate-200">Focus Mode</div>
              <div className="text-xs text-slate-400">Hides navbar and side controls during class</div>
            </div>
            <Button
              variant={focusMode ? 'primary' : 'secondary'}
              size="sm"
              onClick={toggleFocusMode}
            >
              {focusMode ? 'Enabled' : 'Enable'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
