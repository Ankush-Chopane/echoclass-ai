'use client';

import { useEffect } from 'react';

export default function ErrorBoundary({ error, reset }) {
  useEffect(() => {
    console.error('Next.js Page Error:', error);
  }, [error]);

  return (
    <div style={{
      maxWidth: '600px',
      margin: '4rem auto',
      padding: '2rem',
      background: '#0f172a',
      border: '1px solid #1e293b',
      borderRadius: '1rem',
      textAlign: 'center'
    }}>
      <h2 style={{ color: '#f87171', fontSize: '1.5rem', marginBottom: '1rem' }}>
        ⚠️ Educational Content Error
      </h2>
      <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
        {error?.message || 'An unexpected error occurred while rendering this page.'}
      </p>
      <button
        onClick={() => reset()}
        style={{
          background: '#334155',
          color: '#ffffff',
          border: 'none',
          padding: '0.5rem 1rem',
          borderRadius: '0.5rem',
          fontWeight: 600,
          cursor: 'pointer'
        }}
      >
        Try Again
      </button>
    </div>
  );
}
