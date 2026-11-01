import React, { forwardRef } from 'react';

export const Input = forwardRef(function Input(
  {
    label,
    error,
    helperText,
    id,
    type = 'text',
    className = '',
    required = false,
    ...props
  },
  ref
) {
  const inputId = id || props.name || Math.random().toString(36).substring(7);

  return (
    <div className="flex flex-col gap-1.5 w-full text-left">
      {label && (
        <label htmlFor={inputId} className="text-xs font-semibold uppercase tracking-wider text-slate-300">
          {label} {required && <span className="text-rose-400">*</span>}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        type={type}
        required={required}
        aria-invalid={!!error}
        aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-help` : undefined}
        className={`w-full bg-slate-900 border rounded-lg px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
          error ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-700 hover:border-slate-600'
        } ${className}`}
        {...props}
      />
      {error && (
        <p id={`${inputId}-error`} className="text-xs text-rose-400 font-medium">
          {error}
        </p>
      )}
      {helperText && !error && (
        <p id={`${inputId}-help`} className="text-xs text-slate-400">
          {helperText}
        </p>
      )}
    </div>
  );
});
