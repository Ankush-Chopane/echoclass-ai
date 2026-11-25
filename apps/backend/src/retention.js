// Transcript retention: deletes ended lessons older than the classroom's retention period (or the server default).
// Never touches live lessons. A retention of 0/null means "keep until a teacher deletes it".
const log = require('./log');
function purgeExpired(db, defaultDays = 0, now = Date.now()) {
  const rows = db.prepare('SELECT id, retention_days FROM classrooms').all();
  const del = db.prepare('DELETE FROM sessions WHERE classroom_id=? AND ended_at IS NOT NULL AND ended_at < ?');
  let sessions = 0;
  for (const c of rows) {
    const days = c.retention_days ?? defaultDays;
    if (!days || days <= 0) continue;
    sessions += del.run(c.id, now - days * 86400000).changes;
  }
  if (sessions) log.info('retention purge', { sessions });
  return { sessions };
}
module.exports = { purgeExpired };