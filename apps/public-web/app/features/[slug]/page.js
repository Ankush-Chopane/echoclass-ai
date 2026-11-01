import { notFound } from 'next/navigation';
import Link from 'next/link';
import { FEATURES, getFeatureBySlug } from '../../../lib/features-data';
import { CLASSROOM_URL } from '../../../lib/site';

// Pre-render all features statically at build time (Unit II: SSG)
export async function generateStaticParams() {
  return FEATURES.map((feature) => ({
    slug: feature.slug
  }));
}

// Dynamic Metadata generation (Unit V: Metadata API)
export async function generateMetadata({ params }) {
  const feature = getFeatureBySlug(params.slug);
  if (!feature) return { title: 'Feature Not Found' };
  return {
    title: `${feature.title} — Technical Overview`,
    description: feature.summary
  };
}

export default function FeatureDetailPage({ params }) {
  const feature = getFeatureBySlug(params.slug);

  if (!feature) {
    notFound();
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '3rem 1.5rem' }}>
      <Link
        href="/features"
        style={{ color: '#94a3b8', fontSize: '0.85rem', textDecoration: 'none', marginBottom: '1.5rem', display: 'inline-block' }}
      >
        ← Back to All Features
      </Link>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem' }}>
        <span style={{ fontSize: '2.5rem' }}>{feature.icon}</span>
        <h1 style={{ fontSize: '2.2rem', fontWeight: 900, color: '#f8fafc', margin: 0 }}>
          {feature.title}
        </h1>
      </div>

      <div style={{
        background: '#0f172a',
        border: '1px solid #1e293b',
        borderRadius: '1rem',
        padding: '2rem',
        marginTop: '2rem'
      }}>
        <h2 style={{ fontSize: '1.25rem', color: '#4ade80', fontWeight: 700, marginTop: 0 }}>
          Architecture & Implementation
        </h2>
        <p style={{ color: '#cbd5e1', lineHeight: 1.7, fontSize: '1rem' }}>
          {feature.description}
        </p>

        <h3 style={{ fontSize: '1rem', color: '#f8fafc', fontWeight: 700, marginTop: '1.5rem', marginBottom: '0.75rem' }}>
          Key Advantages in Classroom Environments
        </h3>
        <ul style={{ color: '#94a3b8', lineHeight: 1.7, fontSize: '0.9rem', paddingLeft: '1.25rem' }}>
          {feature.benefits.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </div>

      <div style={{ marginTop: '2.5rem', textAlign: 'center' }}>
        <a
          href={CLASSROOM_URL}
          target="_blank"
          rel="noreferrer"
          style={{
            background: '#16a34a',
            color: '#ffffff',
            padding: '0.75rem 1.5rem',
            borderRadius: '0.5rem',
            fontWeight: 700,
            fontSize: '0.9rem',
            textDecoration: 'none'
          }}
        >
          Try in Live Classroom App 🎙️
        </a>
      </div>
    </div>
  );
}
