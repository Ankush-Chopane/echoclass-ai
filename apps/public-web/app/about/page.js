export const metadata = {
  title: 'About the Project — EchoClass AI',
  description: 'Academic background, problem statement, and technical architecture of EchoClass AI.'
};

export default function AboutPage() {
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '3rem 1.5rem' }}>
      <h1 style={{ fontSize: '2.5rem', fontWeight: 900, color: '#f8fafc', marginBottom: '1rem' }}>
        About EchoClass AI
      </h1>
      <p style={{ color: '#94a3b8', fontSize: '1.1rem', lineHeight: 1.6, marginBottom: '2.5rem' }}>
        An accessibility platform designed as coursework demonstration for college students with hearing and speech disabilities.
      </p>

      <section style={{ marginBottom: '2.5rem' }}>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 800, color: '#22c55e', marginBottom: '0.75rem' }}>
          Problem Statement
        </h2>
        <p style={{ color: '#cbd5e1', lineHeight: 1.7, fontSize: '0.95rem' }}>
          Traditional university lectures rely heavily on rapid, uninterrupted verbal instruction. Students with hearing loss or auditory processing challenges struggle to maintain pace, while existing corporate captioning platforms require constant high-speed internet, cloud subscriptions, and expensive proprietary hardware.
        </p>
        <p style={{ color: '#cbd5e1', lineHeight: 1.7, fontSize: '0.95rem' }}>
          EchoClass AI resolves this by running a dedicated server directly on the instructor's laptop on the classroom's local Wi-Fi, delivering synchronized speech captions to student devices with <strong>zero cloud reliance</strong>.
        </p>
      </section>

      <section style={{ marginBottom: '2.5rem', background: '#0f172a', border: '1px solid #1e293b', borderRadius: '1rem', padding: '1.75rem' }}>
        <h2 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#f8fafc', marginBottom: '0.75rem' }}>
          Curriculum & Coursework Context
        </h2>
        <p style={{ color: '#94a3b8', lineHeight: 1.6, fontSize: '0.9rem', marginBottom: '1rem' }}>
          This multi-app project directly demonstrates learning outcomes from two college subjects:
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
          <div style={{ background: '#020617', padding: '1rem', borderRadius: '0.5rem', border: '1px solid #334155' }}>
            <strong style={{ color: '#4ade80', display: 'block', marginBottom: '0.25rem' }}>INT252: ReactJS App</strong>
            <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>
              Implemented in <code>apps/classroom-web</code> using React 18, Vite, Hooks, Context API, React Router, Zod validation, and Tailwind CSS.
            </p>
          </div>

          <div style={{ background: '#020617', padding: '1rem', borderRadius: '0.5rem', border: '1px solid #334155' }}>
            <strong style={{ color: '#60a5fa', display: 'block', marginBottom: '0.25rem' }}>INT257: Next.js App</strong>
            <p style={{ color: '#94a3b8', fontSize: '0.85rem', margin: 0, lineHeight: 1.5 }}>
              Implemented in <code>apps/public-web</code> using Next.js App Router, Server Components, Route Handlers, Server Actions, and Metadata API.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
