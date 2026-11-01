import React, { useEffect, useRef } from 'react';

export function Modal({ isOpen, onClose, title, children, maxWidth = 'max-w-lg' }) {
  const panel = useRef(null);
  // Accessibility: move focus into the dialog when it opens, keep Tab inside it, and give focus back to what opened it.
  useEffect(() => {
    if (!isOpen) return undefined;
    const opener = document.activeElement;
    const focusable = () => [...(panel.current?.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') || [])].filter((el) => !el.disabled);
    (panel.current?.querySelector('[autofocus], input, select, textarea') || focusable()[0] || panel.current)?.focus();
    const trap = (e) => {
      if (e.key !== 'Tab') return;
      const els = focusable(); if (!els.length) return;
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', trap);
    return () => { document.removeEventListener('keydown', trap); opener?.focus?.(); };
  }, [isOpen]);

  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      ></div>

      <div
        ref={panel}
        tabIndex={-1}
        className={`relative w-full ${maxWidth} bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl p-6 overflow-hidden z-10`}
      >
        <div className="flex items-center justify-between pb-4 mb-4 border-b border-slate-800">
          <h2 id="modal-title" className="text-lg font-bold text-slate-100">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
            aria-label="Close modal"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <div className="text-slate-200">
          {children}
        </div>
      </div>
    </div>
  );
}
