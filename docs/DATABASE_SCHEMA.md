# Database Schema — EchoClass AI

> **Engine:** SQLite 3 via `better-sqlite3`
> **Mode:** WAL (Write-Ahead Logging), foreign keys ON, synchronous NORMAL
> **File:** `data/echoclass.db` (configurable via `DATABASE_PATH` env var)

---

## Tables

### 1. `users`

Stores all accounts (teachers and students).

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Auto-incrementing user ID |
| `name` | TEXT | NOT NULL | Display name |
| `email` | TEXT | NOT NULL, UNIQUE | Normalized to lowercase |
| `password_hash` | TEXT | NOT NULL | bcrypt hash (cost 11) |
| `role` | TEXT | NOT NULL, CHECK(IN('teacher','student')) | User role |
| `created_at` | INTEGER | NOT NULL | Unix timestamp in milliseconds |
| `token_version` | INTEGER | NOT NULL DEFAULT 0 | Incremented on password change / logout-all to invalidate tokens |
| `last_login_at` | INTEGER | | Unix timestamp of last successful login |

---

### 2. `classrooms`

A classroom created by a teacher. Students enroll via a join code.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Auto-incrementing ID |
| `name` | TEXT | NOT NULL | Classroom name (e.g. "Biology 9") |
| `subject` | TEXT | DEFAULT '' | Optional subject label |
| `code` | TEXT | NOT NULL, UNIQUE | 8-character join code (A-Z, 2-9 only) |
| `teacher_id` | INTEGER | NOT NULL, REFERENCES users(id) | Owning teacher |
| `language` | TEXT | DEFAULT 'en-IN' | Speech recognition language code |
| `created_at` | INTEGER | NOT NULL | Unix timestamp in milliseconds |
| `retention_days` | INTEGER | | Days to keep ended sessions (NULL = use server default) |

**Indexes:** `idx_classrooms_teacher` on `teacher_id`

---

### 3. `enrollments`

Many-to-many relationship between students and classrooms.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `user_id` | INTEGER | NOT NULL, REFERENCES users(id) | Student |
| `classroom_id` | INTEGER | NOT NULL, REFERENCES classrooms(id) ON DELETE CASCADE | Classroom |
| `joined_at` | INTEGER | NOT NULL | Unix timestamp in milliseconds |
| | | PRIMARY KEY(user_id, classroom_id) | Prevents duplicate enrollments |

**Indexes:** `idx_enroll_class` on `classroom_id`

---

### 4. `sessions`

A single live class or recorded lecture within a classroom.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Auto-incrementing ID |
| `classroom_id` | INTEGER | NOT NULL, REFERENCES classrooms(id) ON DELETE CASCADE | Parent classroom |
| `title` | TEXT | NOT NULL | Lecture title (default: classroom name + date) |
| `started_at` | INTEGER | NOT NULL | Unix timestamp in milliseconds |
| `ended_at` | INTEGER | | NULL while the session is live |

**Indexes:**
- `idx_sessions_class` on `(classroom_id, started_at DESC)`
- `idx_sessions_open` on `classroom_id` WHERE `ended_at IS NULL` (partial index)

---

### 5. `captions`

Every caption spoken or signed during a session.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | Auto-incrementing ID |
| `session_id` | INTEGER | NOT NULL, REFERENCES sessions(id) ON DELETE CASCADE | Parent session |
| `source` | TEXT | NOT NULL | `speech`, `typed`, `sign`, or `student` |
| `speaker` | TEXT | NOT NULL | User's display name at time of capture |
| `text` | TEXT | NOT NULL | Caption text (vocabulary-corrected) |
| `t_ms` | INTEGER | NOT NULL | Offset from session start in milliseconds |
| `created_at` | INTEGER | NOT NULL | Unix timestamp in milliseconds |
| `client_id` | TEXT | | Client-generated UUID for deduplication on reconnect |
| `user_id` | INTEGER | | User ID (NULL if the account was deleted) |

**Indexes:**
- `idx_cap_session` on `(session_id, id)`
- `idx_captions_user` on `user_id` WHERE `user_id IS NOT NULL`
- `uq_caption_client` UNIQUE on `(session_id, client_id)` WHERE `client_id IS NOT NULL`

---

### 6. `flags`

Students can flag captions as "confusing" or "important".

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | |
| `session_id` | INTEGER | NOT NULL, REFERENCES sessions(id) ON DELETE CASCADE | |
| `caption_id` | INTEGER | NOT NULL, REFERENCES captions(id) ON DELETE CASCADE | |
| `user_id` | INTEGER | NOT NULL, REFERENCES users(id) | Student who flagged |
| `kind` | TEXT | NOT NULL | `confusing` or `important` |
| `created_at` | INTEGER | NOT NULL | |
| | | UNIQUE(caption_id, user_id, kind) | Each student can flag a caption once per kind |

**Indexes:** `idx_flags_session` on `session_id`

---

### 7. `requests`

Students can send quick requests during a live session.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | |
| `session_id` | INTEGER | NOT NULL, REFERENCES sessions(id) ON DELETE CASCADE | |
| `user_id` | INTEGER | NOT NULL, REFERENCES users(id) | Student who sent the request |
| `kind` | TEXT | NOT NULL | `raise_hand`, `slow_down`, `repeat`, `louder`, `understood` |
| `created_at` | INTEGER | NOT NULL | |

**Indexes:** `idx_requests_session` on `session_id`

---

### 8. `vocab`

Per-classroom word substitutions. The speech recognizer might hear "sir" when the teacher says "CRISPR" — vocab fixes that.

| Column | Type | Constraints | Description |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY | |
| `classroom_id` | INTEGER | NOT NULL, REFERENCES classrooms(id) ON DELETE CASCADE | |
| `heard` | TEXT | NOT NULL | What the recognizer produces |
| `replacement` | TEXT | NOT NULL | What to display instead |
| | | UNIQUE(classroom_id, heard) | One replacement per heard word per classroom |

---

### 9. `audit_log`

Security event log. Never contains passwords or tokens.

| Column | Type | Description |
|---|---|---|
| `id` | INTEGER | PRIMARY KEY |
| `at` | INTEGER | Unix timestamp (milliseconds) |
| `user_id` | INTEGER | User who performed the action (NULL for anonymous) |
| `action` | TEXT | `register`, `login`, `login_failed`, `logout_all`, `password_changed`, `classroom_created`, etc. |
| `ip` | TEXT | Client IP address |
| `detail` | TEXT | Extra context (truncated to 200 chars, never contains secrets) |

**Indexes:** `idx_audit_at` on `at`

---

### 10. `ai_summaries`

Cached AI-generated study notes for ended sessions.

| Column | Type | Description |
|---|---|---|
| `session_id` | INTEGER | PRIMARY KEY, REFERENCES sessions(id) ON DELETE CASCADE |
| `content` | TEXT | JSON-encoded summary object |
| `input_hash` | TEXT | SHA-256 of the transcript sent to the AI (cache key) |
| `provider` | TEXT | `anthropic` or `openai` |
| `model` | TEXT | Model name used |
| `created_at` | INTEGER | Unix timestamp (milliseconds) |
| `created_by` | INTEGER | Teacher user ID |

---

### 11. `ai_usage`

Daily call counter to enforce the `AI_DAILY_LIMIT` setting.

| Column | Type | Description |
|---|---|---|
| `day` | TEXT | PRIMARY KEY, `YYYY-MM-DD` format |
| `calls` | INTEGER | Number of AI summary calls made on this day |

---

### 12. `schema_migrations`

Tracks which migration versions have been applied.

| Column | Type | Description |
|---|---|---|
| `version` | INTEGER | PRIMARY KEY |
| `name` | TEXT | Human-readable description |
| `applied_at` | INTEGER | Unix timestamp (milliseconds) |

---

### 13. `captions_fts` (Virtual Table)

SQLite FTS5 virtual table for full-text caption search.

- Content table: `captions`, content rowid: `id`
- Tokenizer: `unicode61 remove_diacritics 2`
- Kept in sync automatically by three triggers on `captions`:
  - `captions_ai` — after INSERT
  - `captions_ad` — after DELETE
  - `captions_au` — after UPDATE of `text`

Usage in queries:
```sql
SELECT cp.id, cp.text, cp.session_id
FROM captions_fts f
JOIN captions cp ON cp.id = f.rowid
WHERE captions_fts MATCH '"chlorophyll"*'
  AND cp.session_id IN (SELECT id FROM sessions WHERE classroom_id = ?);
```

---

## Relationships (Entity-Relationship Summary)

```
users ──< classrooms (teacher_id)
users ──< enrollments >── classrooms
classrooms ──< sessions
sessions ──< captions
sessions ──< flags
sessions ──< requests
classrooms ──< vocab
captions ──< flags
users ──< flags
users ──< requests
sessions ── ai_summaries
captions ~~~ captions_fts (via triggers)
```

---

## Cascading Deletes

| Delete | Cascades to |
|---|---|
| User deleted | Their enrollments, flags, requests; captions anonymized (speaker set to 'Deleted user', user_id = NULL) |
| Classroom deleted | Enrollments, sessions, captions, flags, requests, vocab, ai_summaries |
| Session deleted | Captions, flags, requests, ai_summaries |
| Caption deleted | Flags |

---

## Backup

```bash
npm run backup
# Produces a consistent copy in data/backups/ without locking the live database.
```

The backup script uses SQLite's online backup API via `better-sqlite3`, which works correctly even while the app is running.

---

## Migration History

| Version | Name | Changes |
|---|---|---|
| 1 | Baseline schema (v1) | All core tables: users, classrooms, enrollments, sessions, captions, flags, requests, vocab |
| 2 | Auth versioning, dedupe, retention, audit log, AI cache | token_version, last_login_at, retention_days, client_id, all indexes, audit_log, ai_summaries, ai_usage |
| 3 | Full-text search | captions_fts virtual table + 3 triggers |
