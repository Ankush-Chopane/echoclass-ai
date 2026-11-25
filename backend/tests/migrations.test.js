const test = require('node:test'), assert = require('node:assert');
const Database = require('better-sqlite3');
const fs = require('fs'), os = require('os'), path = require('path');
const { open } = require('../src/db');
const { start } = require('./helpers');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'echoclass-test-'));

test('a legacy v1 database (pre-migrations) upgrades in place and keeps every row', () => {
  const dir = tmp(), file = path.join(dir, 'legacy.db');
  const legacy = new Database(file);
  legacy.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('teacher','student')), created_at INTEGER NOT NULL);
    CREATE TABLE classrooms(id INTEGER PRIMARY KEY, name TEXT NOT NULL, subject TEXT DEFAULT '', code TEXT NOT NULL UNIQUE, teacher_id INTEGER NOT NULL REFERENCES users(id), language TEXT DEFAULT 'en-IN', created_at INTEGER NOT NULL);
    CREATE TABLE enrollments(user_id INTEGER NOT NULL REFERENCES users(id), classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE, joined_at INTEGER NOT NULL, PRIMARY KEY(user_id, classroom_id));
    CREATE TABLE sessions(id INTEGER PRIMARY KEY, classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE, title TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER);
    CREATE TABLE captions(id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, source TEXT NOT NULL, speaker TEXT NOT NULL, text TEXT NOT NULL, t_ms INTEGER NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE flags(id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, caption_id INTEGER NOT NULL REFERENCES captions(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(caption_id, user_id, kind));
    CREATE TABLE requests(id INTEGER PRIMARY KEY, session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id), kind TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE vocab(id INTEGER PRIMARY KEY, classroom_id INTEGER NOT NULL REFERENCES classrooms(id) ON DELETE CASCADE, heard TEXT NOT NULL, replacement TEXT NOT NULL, UNIQUE(classroom_id, heard));
    INSERT INTO users VALUES(1,'Old Teacher','old@example.com','$2a$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234','teacher',1000);
    INSERT INTO classrooms(id,name,code,teacher_id,created_at) VALUES(1,'Legacy class','ABC123',1,1000);
    INSERT INTO sessions VALUES(1,1,'Old lesson',1000,5000);
    INSERT INTO captions VALUES(1,1,'speech','Old Teacher','Legacy photosynthesis lecture',100,1100);
    INSERT INTO vocab(classroom_id,heard,replacement) VALUES(1,'foo','bar');`);
  legacy.close();
  const db = open(file);
  assert.deepEqual(db.migrationsApplied, [1, 2, 3]);
  assert.equal(db.prepare('SELECT email FROM users').get().email, 'old@example.com');
  assert.equal(db.prepare('SELECT token_version FROM users').get().token_version, 0);
  assert.equal(db.prepare('SELECT code FROM classrooms').get().code, 'ABC123');       // old 6-char codes keep working
  assert.equal(db.prepare('SELECT COUNT(*) n FROM captions').get().n, 1);
  assert.equal(db.prepare("SELECT rowid FROM captions_fts WHERE captions_fts MATCH 'photosynthesis'").all().length, 1);   // legacy rows are searchable after migration
  assert.equal(db.pragma('foreign_key_check').length, 0);
  db.close();
  const again = open(file); assert.deepEqual(again.migrationsApplied, []); again.close();   // idempotent: reopening applies nothing
  fs.rmSync(dir, { recursive: true });
});

test('data persists across a full app restart (file-backed database)', async () => {
  const dir = tmp(), file = path.join(dir, 'persist.db');
  let h = await start({ DATABASE_PATH: file, JWT_SECRET: 's'.repeat(40) });
  const T = await h.user('teacher', 'Persist'); const cls = await h.classroom(T); const sess = await h.live(T, cls, 'Before restart');
  const ws = await h.connect(T, sess.id); ws.send(JSON.stringify({ type: 'caption', source: 'speech', final: true, text: 'This must survive a restart.' })); await new Promise(r => setTimeout(r, 200)); ws.close();
  await h.api(`/api/sessions/${sess.id}/end`, { method: 'POST', token: T.token }); await h.close();
  h = await start({ DATABASE_PATH: file, JWT_SECRET: 's'.repeat(40) });                    // same secret: old token still valid after restart
  const r = await h.api(`/api/sessions/${sess.id}/captions`, { token: T.token });
  assert.equal(r.status, 200); assert.equal(r.body.items[0].text, 'This must survive a restart.');
  assert.deepEqual(h.ctx.db.migrationsApplied, []); await h.close(); fs.rmSync(dir, { recursive: true });
});

test('backup script produces a consistent, openable copy', async () => {
  const dir = tmp(), file = path.join(dir, 'live.db'), out = path.join(dir, 'backup.db');
  const db = open(file); db.prepare("INSERT INTO users(name,email,password_hash,role,created_at) VALUES('a','a@example.com','x','student',1)").run(); db.close();
  const { backup } = require('../scripts/backup');
  await backup(file, out);
  const copy = open(out, { readonly: true }); assert.equal(copy.prepare('SELECT COUNT(*) n FROM users').get().n, 1); assert.equal(copy.pragma('integrity_check', { simple: true }), 'ok'); copy.close();
  await assert.rejects(backup(file, file), /same/); fs.rmSync(dir, { recursive: true });
});
