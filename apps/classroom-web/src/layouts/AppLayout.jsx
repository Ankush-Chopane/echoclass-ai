import React from 'react';
import { Outlet } from 'react-router-dom';
import { Navbar } from '../components/common/Navbar';

export function AppLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 font-sans">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-emerald-700 focus:text-white focus:px-3 focus:py-2 focus:rounded">Skip to main content</a>
      <Navbar />
      <main id="main" tabIndex={-1} className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-slate-900 py-6 text-center text-xs text-slate-400">
        <div className="max-w-7xl mx-auto px-4">
          EchoClass AI — Every Word. Every Gesture. Every Student Included. Speech and gesture recognition can make mistakes; they do not replace interpreters or professional captioners.
        </div>
      </footer>
    </div>
  );
}
