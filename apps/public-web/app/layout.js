import { Header } from '../components/Header';
import { Footer } from '../components/Footer';

export const metadata = {
  title: {
    default: 'EchoClass AI — Accessibility Platform for Classrooms',
    template: '%s | EchoClass AI'
  },
  description: 'Real-time speech-to-text captions, MediaPipe sign-language gestures, and offline SQLite persistence for inclusive classrooms.',
  keywords: ['accessibility', 'speech-to-text', 'sign language', 'deaf education', 'classroom technology', 'Next.js', 'React'],
  authors: [{ name: 'EchoClass AI Research Team' }]
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{
        margin: 0,
        padding: 0,
        background: '#0b0f19',
        color: '#f8fafc',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column'
      }}>
        <Header />
        <main style={{ flex: 1 }}>
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
