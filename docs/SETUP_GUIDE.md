# Setup Guide — EchoClass AI

## Prerequisites
Node.js >= 22.12, npm >= 10. Python >= 3.8 only for offline Vosk speech. Chromium/Chrome for `npm run e2e`.

## 1. Install
```bash
npm ci
```
`better-sqlite3` ships prebuilt binaries for common platforms. If `npm ci` fails while compiling it (no compiler or blocked download), run `npm ci --ignore-scripts` — the prebuilt binary is still used. Verify with `npm run preflight`.

## 2. Configure
```bash
cp .env.example .env     # optional locally; required values in production: JWT_SECRET, TEACHER_INVITE_CODE
```
Generate a secret: `openssl rand -hex 32`.

## 3. Models (optional but recommended)
```bash
npm run fetch-model            # MediaPipe hand model; otherwise loaded from Google's CDN at runtime
npm run fetch-speech-model     # Vosk model for offline speech (also: pip install vosk)
```

## 4. Run
```bash
npm run build:classroom && npm start        # http://localhost:3000
# development:
npm run dev:backend      # terminal 1 (port 3000)
npm run dev:classroom    # terminal 2 (port 5173)
npm run dev:public       # optional (port 3001)
```
Classmates on the same Wi-Fi open the LAN address shown on the teacher's dashboard. Camera/microphone need HTTPS or localhost: `npm run gen-cert`, then `HTTPS_ENABLED=true`.

## 5. Test
```bash
npm test          # backend + React/API integration
npm run build     # both frontends
npm run e2e       # Playwright (CHROMIUM_PATH=/path/to/chrome if needed)
```

## 6. Deploy
See README → Deployment (Docker Compose, Render blueprint). Always mount persistent storage at `/data`.

## Troubleshooting
| Symptom | Cause / fix |
|---|---|
| "Frontend not built" page (503) | Run `npm run build:classroom` |
| Server refuses to start in production | The message lists missing `JWT_SECRET` / `TEACHER_INVITE_CODE` / https `AI_BASE_URL` |
| Offline speech "unavailable" | No Vosk model in `models/vosk` or `pip install vosk` missing |
| Camera panel "model not loaded" | Run `npm run fetch-model` or allow access to Google's CDN |
| Data lost after redeploy | Database not on a persistent disk |
