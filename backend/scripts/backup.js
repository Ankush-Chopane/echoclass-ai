// Consistent online backup of the SQLite database (safe while the app is running).
//   npm run backup                       -> ./backups/echoclass-<timestamp>.db
//   npm run backup -- /path/out.db
const Database = require('better-sqlite3');
const fs = require('fs'), path = require('path');

async function backup(src, dest) {
  if (path.resolve(src) === path.resolve(dest)) throw new Error('Backup destination must differ from the same source file.');
  if (!fs.existsSync(src)) throw new Error(`Database not found: ${src}`);
  fs.mkdirSync(path.dirname(path.resolve(dest)), { recursive: true });
  const db = new Database(src, { readonly: true, fileMustExist: true });
  try { await db.backup(dest); } finally { db.close(); }
  const check = new Database(dest, { readonly: true });
  const ok = check.pragma('integrity_check', { simple: true }); check.close();
  if (ok !== 'ok') throw new Error('Backup failed integrity check: ' + ok);
  return dest;
}
module.exports = { backup };

if (require.main === module) {
  const src = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'database', 'echoclass.db');
  const dest = process.argv[2] || path.join('backups', `echoclass-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  backup(src, dest).then(d => console.log('Backup written to', d), e => { console.error(e.message); process.exit(1); });
}