import Link from 'next/link';
import { FEATURES } from '../../lib/features-data';

export const metadata = {
  title: 'Accessibility Features — EchoClass AI',
  description: 'Explore live captions, on-device gesture recognition, and offline SQLite storage.'
};

export default function FeaturesPage() {
  return (
    <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '3rem 1.5rem' }}>
      <h1 style={{ fontSize: '2.5rem', fontWeight: 900, color: '#f8fafc', marginBottom: '0.75rem' }}>
        Accessibility Features
      </h1>
      <p style={{ color: '#94a3b8', fontSize: '1.1rem', marginBottom: '2.5rem' }}>
        Complete technical breakdown of the inclusive tools built into EchoClass AI.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        {FEATURES.map((f) => (
          <div
            key={f.slug}
            style={{
              background: '#0f172a',
              border: '1px solid #1e293b',
              borderRadius: '1rem',
              padding: '2rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '2rem' }}>{f.icon}</span>
              <div>
                <h2 style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f8fafc', margin: 0 }}>
                  {f.title}
                </h2>
                <span style={{
                  fontSize: '0.75rem',
                  color: '#4ade80',
                  fontWeight: 600,
                  background: 'rgba(22, 163, 74, 0.15)',
                  padding: '0.15rem 0.5rem',
                  borderRadius: '0.25rem',
                  display: 'inline-block',
                  marginTop: '0.25rem'
                }}>
                  {f.offlineCapable ? 'Offline Capable' : 'Cloud Optional'}
                </span>
              </div>
            </div>

            <p style={{ color: '#cbd5e1', lineHeight: 1.6, fontSize: '0.95rem', margin: 0 }}>
              {f.description}
            </p>

            <ul style={{ color: '#94a3b8', fontSize: '0.875rem', paddingLeft: '1.25rem', margin: 0, lineHeight: 1.6 }}>
              {f.benefits.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>

            <div style={{ marginTop: '0.5rem' }}>
              <Link
                href={`/features/${f.slug}`}
                style={{
                  color: '#22c55e',
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  textDecoration: 'none'
                }}
              >
                View Deep-Dive Architecture →
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
