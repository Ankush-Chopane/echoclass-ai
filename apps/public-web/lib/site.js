// URL of the classroom app (React + Vite, served by the Express backend). Set NEXT_PUBLIC_CLASSROOM_URL at build time.
export const CLASSROOM_URL = (process.env.NEXT_PUBLIC_CLASSROOM_URL || 'http://localhost:3000').replace(/\/+$/, '');
