const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const { migrate } = require('./migrations');

/**
 * Open or create the SQLite database with WAL mode and foreign keys enabled.
 * @param {string} file - Path to SQLite database file or ':memory:'
 * @param {object} options
 * @param {boolean} [options.readonly=false]
 */
function open(file, { readonly = false } = {}) {
  if (file !== ':memory:' && !readonly) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }
  const db = new Database(file, { readonly });
  if (!readonly) {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 5000');
  }
  db.pragma('foreign_keys = ON');
  if (!readonly) {
    db.migrationsApplied = migrate(db);
  }
  return db;
}

module.exports = { open };
