import { FeedbackForm } from '../../components/FeedbackForm';

export const metadata = {
  title: 'Help & Documentation — EchoClass AI',
  description: 'Setup guide, local Wi-Fi connection instructions, and feedback submission.'
};

export default function HelpPage() {
  return (
    <div style={{ maxWidth: '900px', margin: '0 auto', padding: '3rem 1.5rem' }}>
      <h1 style={{ fontSize: '2.5rem', fontWeight: 900, color: '#f8fafc', marginBottom: '0.75rem' }}>
        Help & Setup Guide
      </h1>
      <p style={{ color: '#94a3b8', fontSize: '1.1rem', marginBottom: '2.5rem' }}>
        Everything you need to set up EchoClass AI in your college classroom.
      </p>

      {/* Quick Setup Checklist */}
      <div style={{
        background: '#0f172a',
        border: '1px solid #1e293b',
        borderRadius: '1rem',
        padding: '2rem',
        marginBottom: '2.5rem'
      }}>
        <h2 style={{ fontSize: '1.25rem', color: '#22c55e', fontWeight: 800, marginTop: 0 }}>
          3-Step Classroom Launch
        </h2>

        <ol style={{ color: '#cbd5e1', lineHeight: 1.8, fontSize: '0.95rem', paddingLeft: '1.25rem' }}>
          <li>
            <strong>Start the Server on the Instructor's Laptop:</strong><br />
            Run <code>npm run dev</code> from the terminal. The console displays your machine's local Wi-Fi IP (e.g. <code>http://192.168.1.15:3000</code>).
          </li>
          <li>
            <strong>Connect Student Phones / Laptops:</strong><br />
            Students connect to the classroom Wi-Fi and open the teacher's local IP address in their browser. No installation or app store download is required.
          </li>
          <li>
            <strong>Create & Join with Classroom Code:</strong><br />
            The instructor creates a classroom and shares the 6-character code (e.g., <code>7X9K2W</code>). When the lecture begins, live speech captions stream synchronously.
          </li>
        </ol>
      </div>

      {/* Server Action Feedback Section */}
      <FeedbackForm />
    </div>
  );
}
