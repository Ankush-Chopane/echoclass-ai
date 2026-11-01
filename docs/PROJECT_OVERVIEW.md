# Project Overview — EchoClass AI

## What Is EchoClass AI?

EchoClass AI is an **accessibility web application** for classrooms. It gives deaf and hard-of-hearing students access to live captions of the teacher's lecture, supports student responses through gestures and text, and saves every class as a searchable transcript.

## Who Is It For?

| User | How they use it |
|---|---|
| **Teacher** | Runs the app on their laptop. Speaks into the microphone. Manages classrooms and lectures. |
| **Student (hearing impaired)** | Opens the URL on their phone or laptop. Reads live captions. Responds via gestures, quick phrases, or text. |
| **Student (general)** | Can also use captions and respond, but the primary beneficiaries are students with hearing disabilities. |

## The Problem

Students with hearing disabilities are excluded from lectures that rely entirely on verbal communication. Professional interpreters and captioners are expensive and unavailable in most classrooms. Cloud-based captioning tools require reliable internet and subscriptions.

## The Solution

EchoClass AI runs on the teacher's laptop. Students connect over the classroom's local Wi-Fi. Captions work without internet when the offline Vosk engine is installed; the browser Web Speech API (Chrome/Edge/Safari) sends audio to the browser vendor's cloud. Setup: `npm ci && npm run build:classroom && npm start`.

## What EchoClass AI Is NOT

> **This is important to be honest about.**
>
> - It does **not** translate sign language. It recognises a small set of predefined hand poses (12 gestures).
> - Speech recognition makes mistakes, especially on technical vocabulary.
> - It does not replace professional sign-language interpreters or captioners.
> - The AI summary feature (optional) requires an internet connection and an API key.

## Files You Need to Know

| File | What it does |
|---|---|
| `apps/backend/src/server.js` | Start here — entry point |
| `apps/backend/src/app.js` | All Express routes and middleware |
| `apps/backend/src/realtime.js` | WebSocket live captions |
| `apps/backend/src/migrations.js` | Database schema |
| `apps/classroom-web/src/App.jsx` | React routes |
| `apps/classroom-web/src/services/api.js` | API client (auth, errors, downloads) |
| `apps/classroom-web/src/pages/LiveClassroomPage.jsx` | The live classroom screen |
| `packages/shared/gestures.js` | Rule-based gesture engine fed by MediaPipe landmarks |
| `apps/public-web/app/` | Next.js public website |

## Where to Go Next

| If you want to... | Read... |
|---|---|
| Set up the project locally | [`docs/SETUP_GUIDE.md`](SETUP_GUIDE.md) |
| Understand the architecture | [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) |
| See the database tables | [`docs/DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) |
| See all API endpoints | [`docs/API_DOCUMENTATION.md`](API_DOCUMENTATION.md) |
| Prepare for a viva exam | [`docs/VIVA_GUIDE.md`](VIVA_GUIDE.md) |
| Understand the frontend | [`apps/classroom-web`](../apps/classroom-web) |
| Understand the backend | [`apps/backend`](../apps/backend) |
| Deploy to production | See the root [`README.md`](../README.md#12-deployment) |
