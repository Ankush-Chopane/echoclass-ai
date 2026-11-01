// Transcript retention: deletes ended lessons older than the classroom's retention period (or the server default).
// Never touches live lessons. A retention of 0/null means "keep until a teacher deletes it".
const log = require('./log');

async function purgeExpired(db, defaultDays = 0, now = Date.now()) {
  const classrooms = await db.collection('classrooms').find({}).toArray();
  let sessions = 0;
  for (const c of classrooms) {
    const days = c.retention_days ?? defaultDays;
    if (!days || days <= 0) continue;
    const cutoff = now - days * 86400000;
    const expiredSessions = await db.collection('sessions').find({
      classroom_id: c._id,
      ended_at: { $ne: null, $lt: cutoff }
    }).toArray();
    if (expiredSessions.length > 0) {
      const sessionIds = expiredSessions.map(s => s._id);
      await db.collection('captions').deleteMany({ session_id: { $in: sessionIds } });
      await db.collection('flags').deleteMany({ session_id: { $in: sessionIds } });
      await db.collection('requests').deleteMany({ session_id: { $in: sessionIds } });
      await db.collection('ai_summaries').deleteMany({ session_id: { $in: sessionIds } });
      const r = await db.collection('sessions').deleteMany({ _id: { $in: sessionIds } });
      sessions += r.deletedCount;
    }
  }
  if (sessions) log.info('retention purge', { sessions });
  return { sessions };
}

module.exports = { purgeExpired };
