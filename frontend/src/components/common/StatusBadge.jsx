import React from 'react';

export function StatusBadge({ status, label, className = '' }) {
  const styles = {
    live: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    ended: 'bg-slate-700/30 text-slate-400 border-slate-600/30',
    teacher: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
    student: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    warning: 'bg-amber-500/10 text-amber-400 border-amber-500/30'
  };

  const style = styles[status] || styles.ended;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${style} ${className}`}>
      {status === 'live' && (
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
      )}
      {label || status}
    </span>
  );
}

export function LoadingIndicator({ text = 'Loading...' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400" role="status">
      <svg className="animate-spin h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <span className="text-sm font-medium">{text}</span>
    </div>
  );
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center border-2 border-dashed border-slate-800 rounded-2xl bg-slate-900/30">
      <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 mb-3 text-xl">
        📖
      </div>
      <h3 className="text-base font-bold text-slate-200">{title}</h3>
      {description && <p className="text-sm text-slate-400 max-w-sm mt-1 mb-4">{description}</p>}
      {action}
    </div>
  );
}
