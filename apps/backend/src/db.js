const Database = require('better-sqlite3');
const fs = require('fs'), path = require('path');
const { migrate } = require('./migrations');

function open(file, { readonly = false } = {}) {
  if (file !== ':memory:' && !readonly) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file, { readonly });
  if (!readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
  }
  db.pragma('foreign_keys = ON');
  if (!readonly) db.migrationsApplied = migrate(db);
  return db;
}
module.exports = { open };