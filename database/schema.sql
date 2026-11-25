-- ============================================================================
-- EchoClass AI — SQLite Database Schema Reference
-- ============================================================================
-- Engine: SQLite 3 with WAL (Write-Ahead Logging) and Foreign Keys ON
-- File: database/echoclass.db
-- ============================================================================

-- 1. USERS: Teacher & Student accounts
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('teacher', 'student')),
  token_version INTEGER NOT NULL DEFAULT 0,
  last_login_at INTEGER,
  created_at INTEGER NOT NULL
);

-- 2. CLASSROOMS: Created by teachers
CREATE TABLE IF NOT EXISTS classrooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subject TEXT DEFAULT '',
  code TEXT NOT NULL UNIQUE,
  teacher_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language TEXT DEFAULT 'en-IN',
  retention_days INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_classrooms_teacher ON classrooms(teacher_id);

-- 3. ENROLLMENTS: Students joined in classrooms
CREATE TABLE IF NOT EXISTS enrollments (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, classroom_id)
);
CREATE INDEX IF NOT EXISTS idx_enroll_class ON enrollments(classroom_id);

-- 4. SESSIONS: Lecture/Classroom sessions
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_sessions_class ON sessions(classroom_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_open ON sessions(classroom_id) WHERE ended_at IS NULL;

-- 5. CAPTIONS: Real-time speech & sign language captions
CREATE TABLE IF NOT EXISTS captions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source TEXT NOT NULL,          -- 'speech', 'sign', 'typed', 'student'
  speaker TEXT NOT NULL,
  text TEXT NOT NULL,
  t_ms INTEGER NOT NULL,          -- Timestamp offset from session start in ms
  created_at INTEGER NOT NULL,
  client_id TEXT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_cap_session ON captions(session_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_caption_client ON captions(session_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_captions_user ON captions(user_id) WHERE user_id IS NOT NULL;

-- 6. FULL-TEXT SEARCH: Virtual table for real-time search across captions
CREATE VIRTUAL TABLE IF NOT EXISTS captions_fts USING fts5(
  text,
  content='captions',
  content_rowid='id',
  tokenize='unicode61 remove_diacritics 2'
);

-- 7. FLAGS: Student feedback on captions (e.g. 'confusing', 'important')
CREATE TABLE IF NOT EXISTS flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  caption_id INTEGER NOT NULL REFERENCES captions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- 'confusing', 'important'
  created_at INTEGER NOT NULL,
  UNIQUE(caption_id, user_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_flags_session ON flags(session_id);

-- 8. REQUESTS: Live student requests (e.g. 'raise_hand', 'slow_down', 'repeat', 'louder')
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id);

-- 9. VOCABULARY: Custom classroom phonetic replacements
CREATE TABLE IF NOT EXISTS vocab (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
  heard TEXT NOT NULL,
  replacement TEXT NOT NULL,
  UNIQUE(classroom_id, heard)
);

-- 10. AUDIT LOG: Security & compliance logging
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  user_id INTEGER,
  action TEXT NOT NULL,
  ip TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

-- 11. AI STUDY SUMMARIES: Cached AI lecture notes
CREATE TABLE IF NOT EXISTS ai_summaries (
  session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  input_hash TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by INTEGER
);

-- 12. AI USAGE: Daily quota tracking
CREATE TABLE IF NOT EXISTS ai_usage (
  day TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0
);
