import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: the React app runs on :5173 and proxies the API, the live socket and the MediaPipe runtime to the Express backend.
// Override the backend location with VITE_DEV_API_TARGET (default http://localhost:3000). Production uses the same origin, so nothing is proxied.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_DEV_API_TARGET || 'http://localhost:3000';
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        '/api': { target, changeOrigin: true },
        '/ws': { target: target.replace(/^http/, 'ws'), ws: true },
        '/vendor': { target, changeOrigin: true }
      }
    },
    build: { outDir: 'dist', sourcemap: false }
  };
});
