import { CLASSROOM_URL } from '../lib/site';
import Link from 'next/link';
import { FEATURES } from '../lib/features-data';

export const metadata = {
  title: 'Home — Inclusive Classroom Accessibility Platform',
  description: 'EchoClass AI bridges classroom communication through live speech captions and MediaPipe gesture recognition.'
};

export default function HomePage() {
  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '3rem 1.5rem' }}>
      {/* Hero Section */}
      <section style={{ textAlign: 'center', padding: '3rem 0 4rem' }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.5rem',
          background: 'rgba(22, 163, 74, 0.12)',
          border: '1px solid rgba(22, 163, 74, 0.3)',
          color: '#4ade80',
          padding: '0.35rem 0.85rem',
          borderRadius: '9999px',
          fontSize: '0.8rem',
          fontWeight: 700,
          marginBottom: '1.5rem'
        }}>
          <span>♿</span> College Accessibility Research Project
        </div>

        <h1 style={{
          fontSize: 'clamp(2.2rem, 5vw, 3.8rem)',
          fontWeight: 900,
          color: '#ffffff',
          lineHeight: 1.15,
          margin: '0 auto 1.5rem',
          maxWidth: '900px',
          letterSpacing: '-0.02em'
        }}>
          Every Word. Every Gesture.<br />
          <span style={{ color: '#22c55e' }}>Every Student Included.</span>
        </h1>

        <p style={{
          fontSize: '1.15rem',
          color: '#94a3b8',
          maxWidth: '700px',
          margin: '0 auto 2.5rem',
          lineHeight: 1.6
        }}>
          EchoClass AI delivers real-time synchronized speech captions and on-device MediaPipe sign gesture recognition for deaf and hard-of-hearing students — operating completely offline on classroom local Wi-Fi.
        </p>

        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a
            href={CLASSROOM_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              background: '#16a34a',
              color: '#ffffff',
              padding: '0.85rem 1.75rem',
              borderRadius: '0.75rem',
              fontWeight: 800,
              fontSize: '1rem',
              textDecoration: 'none',
              boxShadow: '0 4px 14px rgba(22, 163, 74, 0.4)'
            }}
          >
            Open Interactive Classroom 🎙️
          </a>

          <Link
            href="/features"
            style={{
              background: '#1e293b',
              color: '#f8fafc',
              padding: '0.85rem 1.75rem',
              borderRadius: '0.75rem',
              fontWeight: 700,
              fontSize: '1rem',
              textDecoration: 'none',
              border: '1px solid #334155'
            }}
          >
            Explore System Features →
          </Link>
        </div>
      </section>

      {/* Highlights Grid (Server Components) */}
      <section style={{ marginTop: '2rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <h2 style={{ fontSize: '1.8rem', fontWeight: 800, color: '#f8fafc', margin: '0 0 0.5rem' }}>
            Built for Academic Classrooms
          </h2>
          <p style={{ color: '#64748b', fontSize: '0.95rem' }}>
            Designed specifically for local university classrooms without cloud dependency.
          </p>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1.5rem'
        }}>
          {FEATURES.map((feat) => (
            <div
              key={feat.slug}
              style={{
                background: '#0f172a',
                border: '1px solid #1e293b',
                borderRadius: '1rem',
                padding: '1.75rem',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between'
              }}
            >
              <div>
                <div style={{ fontSize: '2rem', marginBottom: '1rem' }}>{feat.icon}</div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#f8fafc', margin: '0 0 0.5rem' }}>
                  {feat.title}
                </h3>
                <p style={{ color: '#94a3b8', fontSize: '0.875rem', lineHeight: 1.6, margin: '0 0 1.25rem' }}>
                  {feat.summary}
                </p>
              </div>

              <Link
                href={`/features/${feat.slug}`}
                style={{
                  color: '#4ade80',
                  textDecoration: 'none',
                  fontSize: '0.875rem',
                  fontWeight: 700,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.25rem'
                }}
              >
                Read Technical Specification →
              </Link>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
