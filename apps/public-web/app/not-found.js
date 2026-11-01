import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{
      maxWidth: '500px',
      margin: '6rem auto',
      textAlign: 'center',
      padding: '2rem'
    }}>
      <h1 style={{ fontSize: '3rem', fontWeight: 900, color: '#22c55e', margin: 0 }}>404</h1>
      <h2 style={{ fontSize: '1.25rem', color: '#f8fafc', marginTop: '0.5rem' }}>Page Not Found</h2>
      <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginBottom: '2rem' }}>
        The educational topic or documentation page you requested does not exist.
      </p>
      <Link
        href="/"
        style={{
          background: '#16a34a',
          color: '#ffffff',
          textDecoration: 'none',
          padding: '0.6rem 1.25rem',
          borderRadius: '0.5rem',
          fontWeight: 700,
          fontSize: '0.875rem'
        }}
      >
        Return to Overview
      </Link>
    </div>
  );
}
