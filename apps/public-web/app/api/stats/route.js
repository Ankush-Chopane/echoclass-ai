import { NextResponse } from 'next/server';

/**
 * Next.js Route Handler demonstrating Unit III (Route Handlers & REST APIs in Next.js)
 * GET /api/stats returns public metrics regarding platform capabilities.
 */
export async function GET() {
  const stats = {
    platform: 'EchoClass AI',
    version: '2.0.0',
    curriculum: {
      reactCourse: 'INT252',
      nextjsCourse: 'INT257'
    },
    capabilities: {
      speechRecognition: 'Web Speech API + Vosk Kaldi Offline',
      signGestureDetection: 'MediaPipe HandLandmarker (WASM, on-device) + rule-based gesture engine',
      database: 'SQLite (better-sqlite3) in WAL Mode',
      supportedLanguages: 14,
      supportedGestures: 12
    },
    timestamp: new Date().toISOString()
  };

  return NextResponse.json(stats, {
    status: 200,
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120'
    }
  });
}
