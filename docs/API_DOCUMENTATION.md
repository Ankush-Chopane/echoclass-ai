# API Documentation — EchoClass AI

All endpoints are prefixed with `/api`. Responses use `Content-Type: application/json`.

## Authentication

Most endpoints require a JWT token in the `Authorization` header:
```
Authorization: Bearer <token>
```

Tokens are obtained from `POST /api/auth/login` or `POST /api/auth/register`.

### Error Response Format
```json
{ "error": "Human-readable message", "code": "machine_readable_code", "fields": { "fieldName": "per-field message" } }
```

---

## Public Endpoints

### `GET /health`
Health check. No authentication required.

**Response 200:**
```json
{ "ok": true, "version": "2.0.0", "uptimeSec": 3600, "db": "ok" }
```

---

### `GET /api/config`
Returns server capabilities needed by the frontend on startup.

**Response 200:**
```json
{
  "languages": [["en-IN", "English (India)"], ["en-US", "English (US)"], ...],
  "teacherInviteRequired": true,
  "teacherSignupOpen": false,
  "passwordMinLength": 6,
  "aiSummaries": false,
  "serverTranscription": false,
  "retentionChoices": [0, 30, 90, 180, 365],
  "defaultRetentionDays": 0,
  "offlineSpeech": { "available": true, "provider": "vosk", "ready": true }
}
```

---

### `GET /api/system/network` (teacher only)

Returns `{ localIps, port, https, httpsPort, speechEngine: { ready, ... } }` so the dashboard can show the LAN address students can open and whether the offline (Vosk) engine is ready. Students receive `403`.

## Auth Endpoints

### `POST /api/auth/register`
Register a new account.

**Rate limit:** 12 per 15 minutes per IP

**Request body:**
```json
{
  "name": "Alice",
  "email": "alice@example.com",
  "password": "mypassword",
  "role": "student",
  "inviteCode": "TEACHERCODE"
}
```
- `role`: `"student"` or `"teacher"`
- `inviteCode`: Required only for `"teacher"` role when `TEACHER_INVITE_CODE` is configured

**Response 201:**
```json
{
  "token": "<jwt>",
  "user": { "id": 1, "name": "Alice", "email": "alice@example.com", "role": "student" },
  "expiresIn": 28800
}
```

**Errors:** `400` validation, `409` email taken

---

### `POST /api/auth/login`
Log in with email and password.

**Rate limit:** 60 per 15 minutes per IP

**Request body:**
```json
{ "email": "alice@example.com", "password": "mypassword" }
```

**Response 200:**
```json
{ "token": "<jwt>", "user": { ... }, "expiresIn": 28800 }
```

**Errors:** `401` wrong credentials, `429` too many attempts

---

### `GET /api/me`
Get the current user. **Auth required.**

**Response 200:**
```json
{ "id": 1, "name": "Alice", "email": "alice@example.com", "role": "student" }
```

---

### `POST /api/auth/refresh`
Get a new token using the current valid token. **Auth required.**

**Response 200:**
```json
{ "token": "<new-jwt>", "expiresIn": 28800 }
```

---

### `POST /api/auth/logout-all`
Invalidate all tokens (all devices). **Auth required.**

**Response 200:**
```json
{ "ok": true }
```

---

### `PATCH /api/me/password`
Change password. **Auth required.**

**Request body:**
```json
{ "currentPassword": "old", "newPassword": "new" }
```

**Response 200:**
```json
{ "token": "<new-jwt>", "expiresIn": 28800 }
```

**Errors:** `403` wrong current password, `400` new password invalid

---

### `DELETE /api/me`
Delete account. **Auth required.** Teachers must delete their classrooms first.

**Request body:**
```json
{ "password": "mypassword" }
```

**Response 200:**
```json
{ "ok": true }
```

---

## Dashboard

### `GET /api/dashboard`
Dashboard data for the current user. **Auth required.**

**Response 200 (teacher):**
```json
{
  "role": "teacher",
  "classrooms": [{ "id": 1, "name": "Biology 9", "subject": "", "live": 3, "students": 12, "lectures": 7, "code": "ABCDEF12", "retention_days": null }],
  "recent": [{ "id": 5, "title": "Cells", "started_at": 1700000000000, "ended_at": 1700003600000, "classroom_id": 1, "classroom_name": "Biology 9", "captions": 42, "participants": 8, "has_ai": false }],
  "live": [{ "classroom_id": 1, "name": "Biology 9", "session_id": 3 }],
  "totals": { "classrooms": 1, "students": 12, "lectures": 7 }
}
```

**Response 200 (student):**
```json
{
  "role": "student",
  "classrooms": [{ "id": 1, "name": "Biology 9", "teacher_name": "Mr. Smith", "live": 3, "lectures": 7 }],
  "recent": [...],
  "live": [...]
}
```

---

## Classrooms

### `GET /api/classrooms`
List all classrooms the current user belongs to. **Auth required.**

**Response 200:**
```json
[{ "id": 1, "name": "Biology 9", "subject": "", "language": "en-IN", "teacher_name": "Mr. Smith", "live": null, "students": 12 }]
```

---

### `POST /api/classrooms`
Create a new classroom. **Teacher only.**

**Request body:**
```json
{ "name": "Biology 9", "subject": "Science", "language": "en-IN" }
```

**Response 201:**
```json
{ "id": 1, "name": "Biology 9", "subject": "Science", "language": "en-IN", "code": "ABCDEF12", "teacher_name": "Mr. Smith", "created_at": 1700000000000 }
```

---

### `POST /api/classrooms/join`
Join a classroom by code. **Student only.**

**Rate limit:** 10 per minute per user

**Request body:**
```json
{ "code": "ABCDEF12" }
```

**Response 200:**
```json
{ "id": 1, "name": "Biology 9", ... }
```

**Errors:** `404` invalid code

---

### `GET /api/classrooms/:id`
Get classroom detail including vocab and roster. **Auth required (must be member).**

**Response 200:**
```json
{
  "id": 1, "name": "Biology 9", "live": { "id": 3, "title": "Cells" },
  "vocab": [{ "id": 1, "heard": "crisper", "replacement": "CRISPR" }],
  "roster": [{ "id": 2, "name": "Alice", "email": "alice@example.com", "joined_at": 1700000000000 }]
}
```

---

### `PATCH /api/classrooms/:id`
Update classroom name/subject/language/retention. **Teacher only.**

**Request body (all optional):**
```json
{ "name": "New Name", "subject": "Biology", "language": "en-IN", "retention_days": 90 }
```

**Response 200:** Updated classroom object.

---

### `DELETE /api/classrooms/:id`
Delete classroom and all its data. **Teacher only.**

**Response 200:** `{ "ok": true }`

---

### `POST /api/classrooms/:id/rotate-code`
Generate a new join code (invalidates the old one). **Teacher only.**

**Response 200:** `{ "code": "XYZXYZ12" }`

---

### `DELETE /api/classrooms/:id/membership`
Leave a classroom. **Student only.**

**Response 200:** `{ "ok": true }`

---

### `DELETE /api/classrooms/:id/students/:uid`
Remove a student from the classroom. **Teacher only.**

**Response 200:** `{ "ok": true }`

---

### `POST /api/classrooms/:id/vocab`
Add or update a vocabulary correction. **Teacher only.**

**Request body:**
```json
{ "heard": "crisper", "replacement": "CRISPR" }
```

**Response 200:** Full updated vocab list.

---

### `DELETE /api/classrooms/:id/vocab/:vid`
Delete a vocabulary correction. **Teacher only.**

**Response 200:** Full updated vocab list.

---

### `GET /api/classrooms/:id/sessions`
List sessions (lectures) with pagination and search. **Auth required (must be member).**

**Query parameters:**
- `page` (default: 1)
- `pageSize` (default: 10, max: 50)
- `q` — search in title and captions
- `from`, `to` — Unix timestamp range filter

**Response 200:**
```json
{
  "items": [{ "id": 5, "title": "Cells", "started_at": 1700000000000, "ended_at": 1700003600000, "captions": 42, "has_ai": false }],
  "total": 15, "page": 1, "pageSize": 10, "pages": 2
}
```

---

### `GET /api/classrooms/:id/search`
Full-text search across all captions in the classroom. **Auth required.**

**Query parameters:**
- `q` — search term (required, min 2 chars)
- `page`, `pageSize`

**Response 200:**
```json
{
  "items": [{ "id": 42, "session_id": 5, "text": "Mitochondria is the powerhouse...", "speaker": "Mr. Smith", "t_ms": 120000, "title": "Cells" }],
  "total": 3, "page": 1, "pageSize": 20
}
```

---

## Sessions

### `POST /api/classrooms/:id/sessions`
Start a live session. If one is already live, returns the existing one. **Teacher only.**

**Request body (optional):**
```json
{ "title": "Cells — Chapter 3" }
```

**Response 200/201:**
```json
{ "id": 5, "classroom_id": 1, "title": "Cells — Chapter 3", "started_at": 1700000000000, "ended_at": null }
```

---

### `POST /api/sessions/:id/end`
End a live session. **Teacher only.**

**Response 200:** Updated session object with `ended_at` set.

---

### `DELETE /api/sessions/:id`
Delete a session and all its data. **Teacher only.**

**Response 200:** `{ "ok": true }`

---

### `GET /api/sessions/:id`
Get session detail including summary, flags, and AI availability. **Auth required (must be member).**

**Response 200:**
```json
{
  "session": { "id": 5, "title": "Cells", "started_at": 1700000000000, "ended_at": 1700003600000 },
  "classroom": { "id": 1, "name": "Biology 9", "language": "en-IN" },
  "requests": { "raise_hand": 3, "slow_down": 1 },
  "summary": { "keywords": [...], "highlights": [...], "stats": { "captions": 42, "words": 1500, "durationMs": 3600000 } },
  "confusing": [{ "id": 12, "text": "...", "n": 5 }],
  "captionCount": 42,
  "ai": { "available": false, "cached": null }
}
```

---

### `GET /api/sessions/:id/captions`
Get captions for a session with pagination. **Auth required (must be member).**

**Query parameters:**
- `limit` (default: 200, max: 500)
- `after` — caption ID cursor (for pagination)
- `q` — full-text search filter

**Response 200:**
```json
{
  "items": [{ "id": 42, "source": "speech", "speaker": "Mr. Smith", "text": "...", "t_ms": 120000 }],
  "flags": { "42": { "confusing": 3 } },
  "nextAfter": 200
}
```

---

### `GET /api/sessions/:id/export`
Download the transcript. **Auth required (must be member).**

**Query parameters:**
- `format`: `txt` (default), `srt`, `vtt`, `json`

**Response:** Binary file with appropriate `Content-Disposition` header.

---

### `POST /api/sessions/:id/ws-ticket`
Get a single-use WebSocket ticket (valid for 30 seconds). **Auth required (must be member, session must be live).**

**Response 200:**
```json
{ "ticket": "abc123...", "expiresInSec": 30 }
```

**Errors:** `410` session has ended, `404` not found

---

### `GET /api/sessions/:id/ai-summary`
Get cached AI summary for a session. **Auth required.**

**Response 200:**
```json
{
  "available": false,
  "cached": null,
  "label": "AI-generated from the lecture transcript. It may contain mistakes."
}
```

---

### `POST /api/sessions/:id/ai-summary`
Generate (or regenerate) an AI summary. **Teacher only.**

**Rate limit:** 6 per minute per user

**Request body:**
```json
{ "confirmExternal": true, "force": false }
```
- `confirmExternal: true` — required consent that transcript will be sent to the AI provider

**Response 200:**
```json
{
  "cached": false,
  "summary": "...",
  "concepts": ["cell", "mitochondria"],
  "keyPoints": ["..."],
  "terms": [{ "term": "mitosis", "meaning": "..." }],
  "questions": ["..."],
  "actionItems": [],
  "notes": "...",
  "generatedAt": 1700000000000,
  "model": "claude-3-5-sonnet-20241022"
}
```

---

### `POST /api/sessions/:id/transcribe`
Server-side transcription of an uploaded audio chunk. **Teacher only.**

**Headers required:**
- `Content-Type: audio/webm` (or audio/ogg, audio/wav, etc.)
- `X-Audio-Consent: yes`
- `X-Audio-Duration-Ms: 5000` (optional)

**Request body:** Raw audio bytes

**Query parameters:**
- `broadcast=1` — also publish the transcription as a caption

**Response 200:**
```json
{ "text": "The cell is the basic unit of life.", "published": true }
```

---

## WebSocket — `/ws?ticket=<ticket>`

The WebSocket handles all real-time communication during a live session.

### Connection
1. Call `POST /api/sessions/:id/ws-ticket` to get a single-use ticket.
2. Connect: `ws://host/ws?ticket=<ticket>`
3. The server validates the ticket, loads the user and session, and adds the client to the room.

### Messages: Server → Client

| Type | Description |
|---|---|
| `init` | Sent on connect: `{ session, captions: [...], flags: {...}, requests: {...}, you: { id, role } }` |
| `caption` | New final caption: `{ caption: { id, source, speaker, text, t_ms } }` |
| `interim` | Partial caption (not saved): `{ speaker, source, text }` |
| `presence` | Users in room: `{ users: [{ id, name, role }] }` |
| `request` | Student request: `{ kind, user, counts: {...} }` |
| `flag` | Caption flagged: `{ captionId, kind, count }` |
| `ack` | Caption acknowledgement: `{ cid, id, duplicate }` |
| `ended` | Session has ended — client should close |
| `error` | `{ code }` — e.g. `rate_limited`, `bad_caption` |
| `pong` | Response to `ping` |

### Messages: Client → Server

| Type | Who | Fields | Description |
|---|---|---|---|
| `caption` | Teacher | `source, final, text, cid?` | Speech or typed caption |
| `caption` | Student | `source: "sign"\|"student", final, text, cid?` | Sign gesture or typed response |
| `request` | Student | `kind` | Quick request (raise_hand, slow_down, etc.) |
| `flag` | Student | `kind, captionId` | Flag a caption |
| `speech_chunk` | Teacher | `data: base64` | Audio chunk for Vosk offline recognition |
| `speech_stop` | Teacher | — | Flush pending audio to Vosk |
| `ping` | Any | — | Keepalive |

Offline-speech errors (server → client `error`): `offline_speech_unavailable` (no Vosk model installed), `offline_speech_busy` (another open lecture is using the single engine), `bad_audio` (invalid base64).

### Source field values

| Value | Sender | Meaning |
|---|---|---|
| `speech` | Teacher | From microphone (Web Speech API or Vosk) |
| `typed` | Teacher | Manually typed |
| `sign` | Student | From gesture recognition |
| `student` | Student | Quick phrase or typed message |

### WebSocket close codes

| Code | Reason |
|---|---|
| `1000` | Normal closure (session ended) |
| `4001` | User was signed out (token invalidated) |
| `4008` | Replaced by a newer connection from the same user |
| `1008` | Too many invalid messages |
