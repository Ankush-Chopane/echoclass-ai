# Architecture — EchoClass AI

```
 Browser (teacher / student)                       Public visitor
 ┌──────────────────────────────┐                  ┌──────────────────────┐
 │ React + Vite SPA             │                  │ Next.js site         │
 │ REST /api/*  (JWT header)    │                  │ static pages,        │
 │ WebSocket /ws?ticket=...     │                  │ links to the SPA     │
 │ MediaPipe WASM (camera)      │                  └──────────────────────┘
 │ Web Speech / WebRTC audio    │
 └──────────────┬───────────────┘
                │ same origin (one port)
 ┌──────────────▼───────────────────────────────────────────────┐
 │ Express 5  (apps/backend/src)                                 │
 │  app.js      REST routes, validation, authorization           │
 │  realtime.js WebSocket rooms, captions, requests, flags       │
 │  security.js headers/CSP, rate limits        config.js env    │
 │  ai.js (optional study notes)  transcribe.js                  │
 │  static: apps/classroom-web/dist, /vendor/mediapipe (WASM)    │
 └──────┬───────────────────────────────┬───────────────────────┘
        │ better-sqlite3 (WAL)
 ┌──────▼────────┐
 │ SQLite file   │
 └───────────────┘
```

## Key decisions

- **One backend, one origin.** Express serves the API, WebSocket and the built React app, so there is no CORS and no hard-coded host. In development Vite proxies `/api`, `/ws` and `/vendor` to port 3000.
- **Auth.** bcrypt password hashes; JWT (HS256) carrying `tv` (token version) so logout-all / password change revokes old tokens; role and ownership checked on every route. WebSockets cannot send headers, so the client first calls `POST /api/sessions/:id/ws-ticket` and connects with a single-use 30-second ticket.
- **Captions and student alerts.** Teacher sends `caption` messages (`final` or interim). The server validates, applies the classroom's vocabulary corrections, de-duplicates by client id (`cid`), stores finals in `captions` (indexed in FTS5), and broadcasts. Students may send `sign`/`student` captions, requests and flags only. New student captions and requests appear as dismissible live alerts on the teacher's screen; the teacher can start the microphone from an alert to reply aloud.
- **Optional teacher audio.** The teacher explicitly enables microphone sharing, and each student separately opts in to listen. WebSocket messages authenticate/route WebRTC signaling; speech audio travels peer-to-peer, is not saved, and stops when sharing ends or a participant disconnects. Microphone access requires browser permission and HTTPS (or localhost). Direct ICE connections are intended for devices on the same local network; other network layouts may require a school-managed TURN server.
- **Gesture cues.** MediaPipe HandLandmarker runs in the browser and yields 21 landmarks; the live app's static MLP classifier maps one-hand poses to 12 application-defined classroom cues. These are not validated ISL signs, and the checked-in model has not been evaluated on real signers. Retraining requires real labeled samples and a person-disjoint validation split.
- **Speech captions.** Teachers use the browser's Web Speech API; supported browsers may send recognition audio to the browser vendor's cloud. There is no offline Vosk recognition mode.
- **Downloads** use `fetch` with the JWT and save a Blob, because a plain `<a href>` cannot send an Authorization header.
- **Persistence.** SQLite file at `DATABASE_PATH`; forward-only migrations at startup; `npm run backup` uses SQLite's online backup.
- **Deployment.** Single container, single instance (in-memory rooms and rate limits), `/data` volume.

See [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) and [API_DOCUMENTATION.md](API_DOCUMENTATION.md).
