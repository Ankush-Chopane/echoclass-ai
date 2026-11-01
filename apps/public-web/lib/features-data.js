export const FEATURES = [
  {
    slug: 'live-speech-captions',
    title: 'Real-Time Speech Captions',
    icon: '🎙️',
    summary: 'Converts teacher speech into instantaneous, synchronized captions distributed to all student screens.',
    description: 'Deaf and hard-of-hearing students can follow lecture dialogue without lag. EchoClass AI leverages the browser Web Speech API for Chromium environments and a local Python-backed Vosk speech engine for completely offline classroom operation.',
    benefits: ['Zero cloud subscription required', 'Configurable font sizing from 18px to 64px', 'Full vocabulary replacement engine for academic terminology'],
    offlineCapable: true
  },
  {
    slug: 'sign-gesture-recognition',
    title: 'Edge Sign Gesture Recognition',
    icon: '✋',
    summary: 'Allows students with speech limitations to participate using discrete hand gestures processed entirely in the browser.',
    description: 'Using MediaPipe HandLandmarker compiled to WebAssembly, the student camera feed tracks 21 3D hand landmarks in real-time. Discrete gestures like Thumbs Up, Raised Hand, Open Palm, and Peace Sign are translated into classroom messages without video ever leaving the device.',
    benefits: ['Camera frames are processed on the device by MediaPipe; video is never uploaded (only the recognised text is sent)', 'Runs smoothly on budget student laptops and tablets', 'Immediate visual HUD feedback during live interaction'],
    offlineCapable: true
  },
  {
    slug: 'sqlite-transcript-persistence',
    title: 'SQLite Lecture Persistence',
    icon: '💾',
    summary: 'Stores every lecture session, caption timestamp, and student interaction in high-performance SQLite.',
    description: 'Lectures are retained using better-sqlite3 with Write-Ahead Logging (WAL) mode enabled. Full-text search (FTS5) indexes ensure students can search past lectures by keyword or date instantly.',
    benefits: ['ACID compliant and transaction-safe', 'Instant search without complex external search servers', 'Exports in TXT, SRT subtitles, and WebVTT formats'],
    offlineCapable: true
  },
  {
    slug: 'multilingual-support',
    title: '14 Language Speech Engine',
    icon: '🌐',
    summary: 'Supports recognition across 14 global and regional languages including Hindi, Marathi, Tamil, and Spanish.',
    description: 'Classrooms can be configured for regional language instruction. Speech engines adapt vocabulary and phonetic models dynamically to accommodate diverse linguistic backgrounds.',
    benefits: ['Native Indian languages support', 'Customizable per-classroom settings', 'Automatic capitalization and punctuation'],
    offlineCapable: true
  }
];

export function getFeatureBySlug(slug) {
  return FEATURES.find((f) => f.slug === slug);
}
