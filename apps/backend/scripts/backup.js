// MongoDB backup: use mongodump
// npm run backup -> runs mongodump to ./backups/echoclass-<timestamp>/
const { execSync } = require('child_process');
const path = require('path');

function backup(uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/echoclass', dest) {
  const target = dest || path.join('backups', `echoclass-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  execSync(`mongodump --uri="${uri}" --out="${target}"`, { stdio: 'inherit' });
  return target;
}

if (require.main === module) {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/echoclass';
  const dest = process.argv[2] || path.join('backups', `echoclass-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  try {
    const target = backup(uri, dest);
    console.log('Backup written to', target);
  } catch (e) {
    console.error('Backup failed:', e.message);
    process.exit(1);
  }
}

module.exports = { backup };
