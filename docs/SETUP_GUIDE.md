# Setup Guide — EchoClass AI

## Prerequisites
Node.js >= 22.12, npm >= 10. Chromium/Chrome for `npm run e2e`.

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

## Cross-network teacher audio (TURN)
Live audio uses WebRTC. The backend supplies a public STUN server by default, which can establish direct calls on many networks. Networks with symmetric NATs or strict firewalls require a TURN relay; STUN alone cannot relay audio.

Use a managed TURN service or a coturn-compatible relay. The Render web service only carries the app/API/WebSocket; it is not itself a TURN relay, so a separate TURN provider/server is needed. For the best chance on restricted Wi-Fi and mobile networks, the provider should support TURN over TLS/TCP on port 443. Set these on the **backend** (for Render, in the service's Environment settings), not in Vercel:

```env
TURN_URLS=turns:your-relay-host:443?transport=tcp
TURN_SHARED_SECRET=your-provider-coturn-rest-shared-secret
TURN_CREDENTIAL_TTL_SECONDS=3600
```

`TURN_SHARED_SECRET` must be at least 32 characters. EchoClass issues short-lived, per-user TURN credentials over the authenticated classroom WebSocket. Keep the shared secret only in backend environment settings; do not commit it or put it in frontend variables. If your provider instead gives you username/password credentials, set `TURN_URLS`, `TURN_USERNAME`, and `TURN_CREDENTIAL` together. Provider-issued temporary credentials are safer than long-lived static credentials.

After setting the backend variables, redeploy it and test with teacher and student devices on different networks (for example, home Wi-Fi and mobile data). TURN relays media and may incur provider bandwidth charges. Without a working TURN service and credentials, no application-only change can guarantee audio on every network.

## Troubleshooting
| Symptom | Cause / fix |
|---|---|
| "Frontend not built" page (503) | Run `npm run build:classroom` |
| Server refuses to start in production | The message lists missing `JWT_SECRET` / `TEACHER_INVITE_CODE` / https `AI_BASE_URL` |
| Teacher speech captions do not appear | Use a browser that supports Web Speech API (Chrome, Edge, or Safari), allow microphone access, and check internet access |
| Live audio fails on another network | Configure a reachable TURN relay on the backend; see Cross-network teacher audio (TURN) |
| Camera panel "model not loaded" | Run `npm run fetch-model` or allow access to Google's CDN |
| Data lost after redeploy | Database not on a persistent disk |
