// Versioned, forward-only migrations. Each runs once, inside a transaction, and never drops user data.
const MIGRATIONS = [
  {
    version: 1,
    name: 'baseline schema (v1 of the app)',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS users(
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('teacher','student')), created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS classrooms(
          id INTEGER PRIMARY KEY, name TEXT NOT NULL, subject TEXT DEFAULT '', code TEXT NOT NULL UNIQUE,
          teacher_id INTEGER NOT NULL REFERENCES users(id), language TEXT DEFAULT 'en-IN', created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS enrollments(
          user_id INTEGER NOT NULL REFERENCES users(id), classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
          joined_at INTEGER NOT NULL, PRIMARY KEY(user_id, classroom_id));
        CREATE TABLE IF NOT EXISTS sessions(
          id INTEGER PRIMARY KEY, classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
          title TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER);
        CREATE TABLE IF NOT EXISTS captions(
          id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          source TEXT NOT NULL, speaker TEXT NOT NULL, text TEXT NOT NULL, t_ms INTEGER NOT NULL, created_at INTEGER NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_cap_session ON captions(session_id, id);
        CREATE TABLE IF NOT EXISTS flags(
          id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          caption_id INTEGER NOT NULL REFERENCES captions(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id),
          kind TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(caption_id, user_id, kind));
        CREATE TABLE IF NOT EXISTS requests(
          id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL, created_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS vocab(
          id INTEGER PRIMARY KEY, classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
          heard TEXT NOT NULL, replacement TEXT NOT NULL, UNIQUE(classroom_id, heard));
      `);
    }
  },

  {
    version: 2,
    name: 'auth versioning, dedupe ids, retention, audit log, AI cache, indexes',
    up(db) {
      db.exec(`
        ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE users ADD COLUMN last_login_at INTEGER;
        ALTER TABLE classrooms ADD COLUMN retention_days INTEGER;
        ALTER TABLE captions ADD COLUMN client_id TEXT;
        ALTER TABLE captions ADD COLUMN user_id INTEGER;
        CREATE UNIQUE INDEX IF NOT EXISTS uq_caption_client ON captions(session_id, client_id) WHERE client_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_sessions_class ON sessions(classroom_id, started_at DESC);
        CREATE INDEX IF NOT EXISTS idx_sessions_open ON sessions(classroom_id) WHERE ended_at IS NULL;
        CREATE INDEX IF NOT EXISTS idx_flags_session ON flags(session_id);
        CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id);
        CREATE INDEX IF NOT EXISTS idx_enroll_class ON enrollments(classroom_id);
        CREATE INDEX IF NOT EXISTS idx_classrooms_teacher ON classrooms(teacher_id);
        CREATE INDEX IF NOT EXISTS idx_captions_user ON captions(user_id) WHERE user_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS audit_log(
          id INTEGER PRIMARY KEY, at INTEGER NOT NULL, user_id INTEGER, action TEXT NOT NULL, ip TEXT, detail TEXT);
        CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
        CREATE TABLE IF NOT EXISTS ai_summaries(
          session_id INTEGER PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
          content TEXT NOT NULL, input_hash TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, created_at INTEGER NOT NULL, created_by INTEGER);
        CREATE TABLE IF NOT EXISTS ai_usage(day TEXT PRIMARY KEY, calls INTEGER NOT NULL DEFAULT 0);
      `);
    }
  },

  {
    version: 3,
    name: 'full-text search for captions',
    up(db) {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS captions_fts USING fts5(text, content='captions', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
        CREATE TRIGGER IF NOT EXISTS captions_ai AFTER INSERT ON captions BEGIN INSERT INTO captions_fts(rowid, text) VALUES (new.id, new.text); END;
        CREATE TRIGGER IF NOT EXISTS captions_ad AFTER DELETE ON captions BEGIN INSERT INTO captions_fts(captions_fts, rowid, text) VALUES('delete', old.id, old.text); END;
        CREATE TRIGGER IF NOT EXISTS captions_au AFTER UPDATE OF text ON captions BEGIN
          INSERT INTO captions_fts(captions_fts, rowid, text) VALUES('delete', old.id, old.text); INSERT INTO captions_fts(rowid, text) VALUES (new.id, new.text); END;
        INSERT INTO captions_fts(captions_fts) VALUES('rebuild');
      `);
    }
  }
];

function migrate(db) {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)');
  const done = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
  const applied = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    db.transaction(() => {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)').run(m.version, m.name, Date.now());
    })();
    applied.push(m.version);
  }
  return applied;
}

module.exports = { migrate, MIGRATIONS };
