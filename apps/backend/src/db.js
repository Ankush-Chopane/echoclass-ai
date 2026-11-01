const { MongoClient } = require('mongodb');
const log = require('./log');

let client, db;

async function connect(uri) {
  client = new MongoClient(uri);
  await client.connect();
  db = client.db(); // uses DB name from URI
  log.info('MongoDB connected');
  await initIndexes(db);
  return db;
}

async function initIndexes(dbInstance) {
  const d = dbInstance || db;
  // users
  await d.collection('users').createIndex({ email: 1 }, { unique: true });
  // classrooms
  await d.collection('classrooms').createIndex({ code: 1 }, { unique: true });
  await d.collection('classrooms').createIndex({ teacher_id: 1 });
  // enrollments
  await d.collection('enrollments').createIndex({ user_id: 1, classroom_id: 1 }, { unique: true });
  await d.collection('enrollments').createIndex({ classroom_id: 1 });
  // sessions
  await d.collection('sessions').createIndex({ classroom_id: 1, started_at: -1 });
  await d.collection('sessions').createIndex({ classroom_id: 1, ended_at: 1 });
  // captions
  await d.collection('captions').createIndex({ session_id: 1, _id: 1 });
  await d.collection('captions').createIndex({ session_id: 1, client_id: 1 }, { unique: true, sparse: true });
  await d.collection('captions').createIndex({ user_id: 1 }, { sparse: true });
  await d.collection('captions').createIndex({ text: 'text' }); // FTS
  // flags
  await d.collection('flags').createIndex({ caption_id: 1, user_id: 1, kind: 1 }, { unique: true });
  await d.collection('flags').createIndex({ session_id: 1 });
  // requests
  await d.collection('requests').createIndex({ session_id: 1 });
  // vocab
  await d.collection('vocab').createIndex({ classroom_id: 1, heard: 1 }, { unique: true });
  await d.collection('vocab').createIndex({ classroom_id: 1 });
  // audit_log
  await d.collection('audit_log').createIndex({ at: -1 });
  // ai_summaries
  await d.collection('ai_summaries').createIndex({ session_id: 1 }, { unique: true });
  // ai_usage
  await d.collection('ai_usage').createIndex({ day: 1 }, { unique: true });
  // counters (for auto-increment IDs)
  await d.collection('counters').createIndex({ _id: 1 });
}

async function nextId(colName, targetDb = db) {
  const r = await targetDb.collection('counters').findOneAndUpdate(
    { _id: colName },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' }
  );
  const doc = r && (r.value !== undefined ? r.value : r);
  return doc ? doc.seq : 1;
}

function getDb() { return db; }
function getClient() { return client; }
async function close() { if (client) await client.close(); }

module.exports = { connect, getDb, getClient, nextId, close };
