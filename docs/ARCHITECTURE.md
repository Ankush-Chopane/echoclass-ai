# Architecture — EchoClass AI

```
 Browser (teacher / student)                       Public visitor
 ┌──────────────────────────────┐                  ┌──────────────────────┐
 │ React + Vite SPA             │                  │ Next.js site         │
 │ REST /api/*  (JWT header)    │                  │ static pages,        │
 │ WebSocket /ws?ticket=...     │                  │ links to the SPA     │
 │ MediaPipe WASM (camera)      │                  └──────────────────────┘
 │ Web Speech / AudioWorklet    │
 └──────────────┬───────────────┘
                │ same origin (one port)
 ┌──────────────▼───────────────────────────────────────────────┐
 │ Express 5  (apps/backend/src)                                 │
 │  app.js      REST routes, validation, authorization           │
 │  realtime.js WebSocket rooms, captions, requests, flags       │
 │  security.js headers/CSP, rate limits        config.js env    │
 │  ai.js (optional study notes)  transcribe.js  speech-engine.js│
 │  static: apps/classroom-web/dist, /vendor/mediapipe (WASM)    │
 └──────┬───────────────────────────────┬───────────────────────┘
        │ better-sqlite3 (WAL)          │ stdin/stdout JSON lines
 ┌──────▼────────┐               ┌──────▼─────────────┐
 │ SQLite file   │               │ vosk_worker.py     │ (optional offline speech)
 └───────────────┘               └────────────────────┘
```

## Key decisions

- **One backend, one origin.** Express serves the API, WebSocket and the built React app, so there is no CORS and no hard-coded host. In development Vite proxies `/api`, `/ws` and `/vendor` to port 3000.
- **Auth.** bcrypt password hashes; JWT (HS256) carrying `tv` (token version) so logout-all / password change revokes old tokens; role and ownership checked on every route. WebSockets cannot send headers, so the client first calls `POST /api/sessions/:id/ws-ticket` and connects with a single-use 30-second ticket.
- **Captions.** Teacher sends `caption` messages (`final` or interim). The server validates, applies the classroom's vocabulary corrections, de-duplicates by client id (`cid`), stores finals in `captions` (indexed in FTS5), and broadcasts. Students may send `sign`/`student` captions, requests and flags only.
- **Gestures.** MediaPipe HandLandmarker runs in the browser and yields 21 landmarks; `packages/shared/gestures.js` (shared with tests and docs) maps them to 12 poses with a stable-hold rule. Video never leaves the device.
- **Speech.** Web Speech API (browser vendor cloud) or offline Vosk (`speech_chunk` WS messages -> Python worker). One engine instance serves one live lecture at a time.
- **Downloads** use `fetch` with the JWT and save a Blob, because a plain `<a href>` cannot send an Authorization header.
- **Persistence.** SQLite file at `DATABASE_PATH`; forward-only migrations at startup; `npm run backup` uses SQLite's online backup.
- **Deployment.** Single container, single instance (in-memory rooms and rate limits), `/data` volume.

See [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) and [API_DOCUMENTATION.md](API_DOCUMENTATION.md).
