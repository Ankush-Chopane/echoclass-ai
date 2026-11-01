import { CLASSROOM_URL } from '../lib/site';
import Link from 'next/link';

export function Header() {
  return (
    <header style={{
      borderBottom: '1px solid #1e293b',
      background: 'rgba(11, 15, 25, 0.85)',
      backdropFilter: 'blur(12px)',
      position: 'sticky',
      top: 0,
      zIndex: 50,
      padding: '0 1.5rem'
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        height: '4rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '2rem' }}>
          <Link href="/" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.6rem',
            textDecoration: 'none',
            color: '#f8fafc',
            fontWeight: 800,
            fontSize: '1.25rem'
          }}>
            <span style={{
              background: '#16a34a',
              color: '#ffffff',
              width: '2rem',
              height: '2rem',
              borderRadius: '0.5rem',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 900
            }}>E</span>
            <span>EchoClass AI</span>
          </Link>

          <nav style={{ display: 'flex', gap: '1.25rem', fontSize: '0.875rem', fontWeight: 500 }}>
            <Link href="/" style={{ color: '#94a3b8', textDecoration: 'none' }}>Overview</Link>
            <Link href="/about" style={{ color: '#94a3b8', textDecoration: 'none' }}>About</Link>
            <Link href="/features" style={{ color: '#94a3b8', textDecoration: 'none' }}>Features</Link>
            <Link href="/help" style={{ color: '#94a3b8', textDecoration: 'none' }}>Documentation</Link>
          </nav>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <a
            href={CLASSROOM_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              background: '#16a34a',
              color: '#ffffff',
              padding: '0.5rem 1rem',
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 700,
              textDecoration: 'none',
              boxShadow: '0 2px 8px rgba(22, 163, 74, 0.3)'
            }}
          >
            Launch Classroom App 🎙️
          </a>
        </div>
      </div>
    </header>
  );
}
