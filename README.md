# EchoClass AI

Live captions for classrooms, with a student response channel (camera hand poses, quick phrases, typing) and saved, searchable transcripts.
Monorepo: **Express + SQLite** backend, **React + Vite** classroom app, **Next.js** public website.

> **Honest scope.** The camera feature uses Google MediaPipe HandLandmarker plus a *rule-based* engine that recognises **12 application-defined hand poses** (see [docs/GESTURES.md](docs/GESTURES.md)). It is **not** sign-language translation and no accuracy figure is claimed ([docs/EVALUATION.md](docs/EVALUATION.md)). Speech recognition makes mistakes. It does not replace interpreters or professional captioners.

## Repository layout

```
apps/
  backend/          Express 5 API + WebSocket + SQLite (the ONE canonical backend)
    src/            server.js (entry) app.js (routes) realtime.js (WS) db.js migrations.js config.js security.js
                    ai.js transcribe.js speech-engine.js text.js ...
    scripts/        preflight, backup, fetch-model, fetch-speech-model, gen-cert, vosk_worker.py, gesture docs/eval
    tests/          node:test suites (auth, classrooms, realtime, migrations, providers, gestures, offline speech, ...)
  classroom-web/    React 18 + Vite 5 + Tailwind: login, dashboard, classroom, live session, transcript
    src/            pages/ components/ hooks/ context/ services/api.js schemas/ layouts/
    tests/          api-contract.test.mjs - the real React API client against the real backend
  public-web/       Next.js 14 (App Router) marketing/help site
packages/shared/    constants + the gesture engine, imported by backend and React
e2e/browser.mjs     Playwright end-to-end test of the production build
docs/               API, schema, architecture, setup, viva, syllabus mapping, gestures
Dockerfile docker-compose.yml render.yaml .env.example
```

## Quick start (local)

Requirements: **Node >= 22.12**, npm >= 10. (Python 3 only for optional offline speech.)

```bash
npm ci                      # if the better-sqlite3 build step fails (no compiler / blocked download): npm ci --ignore-scripts
cp .env.example .env        # optional for local use
npm run fetch-model         # downloads the MediaPipe hand model (~8 MB); the app falls back to Google's CDN without it
npm run build:classroom     # builds the React app into apps/classroom-web/dist
npm start                   # http://localhost:3000  (API + WebSocket + React app, one port)
```

Development with hot reload: `npm run dev:backend` (port 3000) and `npm run dev:classroom` (port 5173, proxies /api, /ws, /vendor). Public site: `npm run dev:public` (port 3001).

First use: register a **student** freely; register a **teacher** (in development no invite code is needed; in production `TEACHER_INVITE_CODE` is required), create a classroom, share the 8-character code, start a lecture. Windows users can double-click `start-classroom.bat`.

Microphone and camera need **HTTPS or localhost**. For classmates on the LAN use `npm run gen-cert` and set `HTTPS_ENABLED=true` (browsers will warn about the self-signed certificate), or deploy behind HTTPS.

## Commands

| Command | Purpose |
|---|---|
| `npm start` | Run backend (+ built React app) |
| `npm run build` | Build classroom app and public site |
| `npm test` | Backend tests + React/API integration tests |
| `npm run e2e` | Browser end-to-end test (needs Chromium: set `CHROMIUM_PATH` or use Playwright's) |
| `npm run backup` | Consistent SQLite backup into `backups/` |
| `npm run preflight` | Check config, database, model files |
| `npm run setup:offline` | Download hand model + Vosk speech model |
| `npm run docs:gestures` | Regenerate docs/GESTURES.md from the engine |

## Environment variables

Complete, commented list in [`.env.example`](.env.example). Required in production: `JWT_SECRET` (>= 32 chars), `TEACHER_INVITE_CODE` (>= 8 chars), a persistent `DATABASE_PATH`. AI study notes are off unless `AI_PROVIDER` is set, need explicit teacher consent per request, and only the *teacher's* captions are sent. Frontend build-time variables: `NEXT_PUBLIC_CLASSROOM_URL` (public site), `VITE_API_BASE_URL`/`VITE_WS_URL` (only if the API is on another origin).

## Deployment

**Docker:** `cp .env.example .env` (set JWT_SECRET, TEACHER_INVITE_CODE) then `docker compose up -d --build`. Data lives in the `echoclass-data` volume (`/data/echoclass.db`).

**Render:** New -> Blueprint -> select the repo. `render.yaml` creates the classroom service (Docker, 1 GB disk at `/data`, generated `JWT_SECRET`, prompts for `TEACHER_INVITE_CODE` and `PUBLIC_URL`) and the optional Next.js site (set `NEXT_PUBLIC_CLASSROOM_URL` before its first build). A persistent disk requires a paid instance; on the free tier the SQLite file is wiped on each deploy. Run a single instance (rate limits and the WebSocket rooms are in memory).

## What changed in this revision (fixes to the uploaded project)

| Area | Problem found | Fix |
|---|---|---|
| Backend | `app.js` used `fs` without importing it - server crashed on start and every test failed | Added import |
| Backend | Two backends (`src/index.js` that never listened, plus `server.js`) and divergent routes | Deleted the dead one; `server.js` + `app.js` are canonical; `config.js` gained `HOST`, `STATIC_DIR`, `PYTHON_PATH`; paths are repo-root based |
| Backend | Offline-speech worker: unhandled stdin errors, double close, no back-off, shell path assumptions | Error handlers, idempotent close, 30 s retry back-off, configurable python, clear `offline_speech_*` errors |
| Backend | `/api/system/network` leaked LAN info to any user | Teacher-only |
| Backend | CSP blocked Google Fonts | `font-src` allows fonts.gstatic.com |
| React | Auth/API client called routes and response shapes that did not exist | `services/api.js` rewritten against the real contract (`GET /me` returns the user; `{items,...}` pagination; `err.fields` from validation errors; 401 -> global sign-out event) |
| React | Live page, transcript, vocabulary, study notes and downloads did not work with the server | Rewritten around WebSocket tickets, `cid` de-duplication, interim/final captions, consent dialog, authenticated blob downloads (a plain link cannot send the JWT) |
| React | Gestures were simulated | Real MediaPipe HandLandmarker (`useHandTracker`) feeding the shared rule engine; honest "no hand" state, nothing invented |
| React | Missing account/offline speech/error handling | Account page, `useOfflineSpeech` (AudioWorklet -> `speech_chunk`), ErrorBoundary, lazy routes, focus-trapped modals |
| Accessibility | Found by axe: white-on-emerald buttons and grey hint text below WCAG AA contrast | Colours darkened/lightened |
| Next.js | `http://localhost:5173` hard-coded in 3 files; stats said 10 gestures; "100% on-device" claim; feedback form implied storage | `NEXT_PUBLIC_CLASSROOM_URL`; accurate numbers/wording |
| Deploy | Dockerfile/render.yaml/.gitignore/.bat files pointed at the old single-folder layout | Rewritten for the monorepo |
| Deps | `zod` high advisory | Upgraded to v4 (forms adapted) |

Existing database schema, migrations, auth model (JWT HS256 + token_version, bcrypt, single-use WS tickets), role/ownership checks and validation were preserved.

## Verification status

Run on a **clean copy** with `npm ci --ignore-scripts`:

| Check | Result |
|---|---|
| Backend tests (`npm run test:backend`) | 81 tests: 80 pass, 0 fail, 1 skipped (real Vosk, needs a model) |
| React <-> API integration (`npm run test:web`) | 14/14: register, login, classroom, join, vocabulary, live WebSocket captions, vocabulary correction, `cid` dedupe, requests/flags, authorization, transcript paging/search, 4 download formats, consent-gated study notes, account, deletion |
| Browser e2e (`npm run e2e`, Chromium on the production build) | 21/21: full UI flow, camera panel loads real MediaPipe WASM + model, axe WCAG A/AA (serious/critical) clean on login, register, dashboard, classroom, transcript; no mobile overflow; no console/CSP errors |
| `npm run build:classroom`, `npm run build:public` | Pass |

**Not verified here (be honest in your viva):**
- **Real hand recognition accuracy.** The sandbox has no real hand footage; only model/WASM loading and the "no hand" path ran. Poses are rule-based and unvalidated.
- **Real offline Vosk transcription.** `pip install vosk` and the model download were blocked; the WebSocket/worker plumbing is tested with a stub worker that does not recognise speech. Test it yourself with `pip install vosk && npm run fetch-speech-model`.
- **Live AI providers** (Anthropic/OpenAI-compatible) - tested against a local stub only.
- **Docker build and Render deployment** - no Docker daemon or Render account here; files follow the documented layout but are untested.
- **Screen readers** - only automated axe checks.
- `npm ci` *with* install scripts (compiling better-sqlite3) - the sandbox blocks the node-gyp header download; prebuilt binaries were used via `--ignore-scripts`.
- `npm audit`: Next.js 14.x still has advisories (DoS in image optimizer / RSC / rewrites) whose fix is a major upgrade to Next 16, which was not attempted; the site uses none of those features and serves static pages. `react-router` 6 advisories concern SSR hydration and a backslash open-redirect in `<Link>`; not used with untrusted URLs here. Upgrade both before a public launch.

## Known limitations

Single server instance; no email verification or password reset; Web Speech API (Chrome/Edge/Safari) sends audio to the browser vendor's cloud - only the Vosk engine is truly offline; gestures are 12 fixed poses; the demo feedback form on the public site stores nothing.

## Documentation

[API](docs/API_DOCUMENTATION.md) · [Database schema](docs/DATABASE_SCHEMA.md) · [Architecture](docs/ARCHITECTURE.md) · [Setup](docs/SETUP_GUIDE.md) · [Syllabus mapping (INT252/INT257)](docs/SYLLABUS_MAPPING.md) · [Viva guide](docs/VIVA_GUIDE.md) · [Gestures](docs/GESTURES.md) · [Production checklist](docs/PRODUCTION_CHECKLIST.md)

## Licence / credits
MediaPipe (Apache-2.0), Vosk (Apache-2.0), better-sqlite3, Express, React, Vite, Next.js.
