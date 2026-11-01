import Link from 'next/link';

export function Footer() {
  return (
    <footer style={{
      borderTop: '1px solid #1e293b',
      background: '#070b14',
      padding: '3rem 1.5rem',
      color: '#64748b',
      fontSize: '0.875rem'
    }}>
      <div style={{
        maxWidth: '1200px',
        margin: '0 auto',
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        gap: '2rem'
      }}>
        <div style={{ maxWidth: '350px' }}>
          <div style={{ color: '#f8fafc', fontWeight: 800, fontSize: '1.1rem', marginBottom: '0.5rem' }}>
            EchoClass AI
          </div>
          <p style={{ lineHeight: 1.6, margin: 0 }}>
            An accessibility-focused platform designed to bridge classroom learning gaps for deaf and hard-of-hearing students.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '3rem' }}>
          <div>
            <div style={{ color: '#e2e8f0', fontWeight: 700, marginBottom: '0.75rem', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Academic Links
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <Link href="/about" style={{ color: '#94a3b8', textDecoration: 'none' }}>Project Mission</Link>
              <Link href="/features" style={{ color: '#94a3b8', textDecoration: 'none' }}>Accessibility Stack</Link>
              <Link href="/help" style={{ color: '#94a3b8', textDecoration: 'none' }}>Setup Guide</Link>
            </div>
          </div>

          <div>
            <div style={{ color: '#e2e8f0', fontWeight: 700, marginBottom: '0.75rem', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Curriculum Context
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span>INT252: ReactJS App</span>
              <span>INT257: Next.js Modern App</span>
              <span>Backend: Node.js & SQLite</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{
        maxWidth: '1200px',
        margin: '2rem auto 0',
        paddingTop: '1.5rem',
        borderTop: '1px solid #111827',
        textAlign: 'center',
        fontSize: '0.75rem'
      }}>
        EchoClass AI — Developed for university coursework demonstration and technical viva evaluation.
      </div>
    </footer>
  );
}
