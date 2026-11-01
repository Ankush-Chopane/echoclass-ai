'use client';

import { useFormState } from 'react-dom';
import { submitFeedback } from '../app/actions';

const initialState = {
  success: false,
  message: '',
  error: ''
};

export function FeedbackForm() {
  const [state, formAction] = useFormState(submitFeedback, initialState);

  return (
    <div style={{
      background: '#0f172a',
      border: '1px solid #1e293b',
      borderRadius: '1rem',
      padding: '2rem',
      maxWidth: '600px',
      margin: '2rem auto'
    }}>
      <h3 style={{ color: '#f8fafc', fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>
        Accessibility Feedback (Server Action)
      </h3>
      <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.5 }}>
        Demonstrating Next.js Server Actions with server-side form mutations and zero client-side API boilerplate.
      </p>

      {state?.success ? (
        <div style={{
          background: 'rgba(22, 163, 74, 0.15)',
          border: '1px solid rgba(22, 163, 74, 0.4)',
          color: '#4ade80',
          padding: '1rem',
          borderRadius: '0.5rem',
          fontSize: '0.875rem',
          fontWeight: 600
        }}>
          ✓ {state.message}
        </div>
      ) : (
        <form action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {state?.error && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.4)',
              color: '#f87171',
              padding: '0.75rem',
              borderRadius: '0.5rem',
              fontSize: '0.875rem'
            }}>
              ⚠️ {state.error}
            </div>
          )}

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Your Name
            </label>
            <input
              name="name"
              type="text"
              required
              placeholder="Dr. Rajesh Gupta"
              style={{
                width: '100%',
                background: '#020617',
                border: '1px solid #334155',
                color: '#f8fafc',
                padding: '0.6rem 0.8rem',
                borderRadius: '0.5rem',
                fontSize: '0.875rem'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Email Address
            </label>
            <input
              name="email"
              type="email"
              required
              placeholder="rajesh@college.edu"
              style={{
                width: '100%',
                background: '#020617',
                border: '1px solid #334155',
                color: '#f8fafc',
                padding: '0.6rem 0.8rem',
                borderRadius: '0.5rem',
                fontSize: '0.875rem'
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: '#cbd5e1', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
              Suggestion or Requirement
            </label>
            <textarea
              name="feedback"
              required
              rows={3}
              placeholder="What accessibility features would improve your classroom experience?"
              style={{
                width: '100%',
                background: '#020617',
                border: '1px solid #334155',
                color: '#f8fafc',
                padding: '0.6rem 0.8rem',
                borderRadius: '0.5rem',
                fontSize: '0.875rem'
              }}
            />
          </div>

          <button
            type="submit"
            style={{
              background: '#16a34a',
              color: '#ffffff',
              border: 'none',
              padding: '0.75rem',
              borderRadius: '0.5rem',
              fontWeight: 700,
              fontSize: '0.875rem',
              cursor: 'pointer',
              marginTop: '0.5rem'
            }}
          >
            Submit Feedback via Server Action 🚀
          </button>
        </form>
      )}
    </div>
  );
}
