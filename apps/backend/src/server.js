const os = require('os');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { load, ConfigError } = require('./config');
const log = require('./log');
const { createApp } = require('./app');

// Auto-load .env from project root (if not already set by the environment)
const envFile = path.resolve(__dirname, '..', '..', '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].split('#')[0].trim();
  }
}

/** Test/embedding helper: createApp with env overrides. */
async function create(env = {}, deps) { return createApp(load({ NODE_ENV: 'test', ...env }, { warn: () => {} }), deps); }

function getLocalIpAddresses() {
  const ifaces = os.networkInterfaces();
  const addresses = [];
  for (const list of Object.values(ifaces)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  return addresses;
}

if (require.main === module) {
  (async () => {
    let cfg;
    try {
      cfg = load(process.env, { warn: (m) => log.warn(m) });
    } catch (e) {
      if (e instanceof ConfigError) {
        console.error('\n' + e.message + '\n\nSee .env.example and README.md → Environment variables.\n');
        process.exit(1);
      }
      throw e;
    }
    log.setLevel(cfg.logLevel);
    const ctx = await createApp(cfg);
    await ctx.purge();

    const localIps = getLocalIpAddresses();
    const primaryLanIp = localIps[0] || '127.0.0.1';

    let httpsServer = null;
    if (cfg.https.enabled) {
      if (fs.existsSync(cfg.https.keyPath) && fs.existsSync(cfg.https.certPath)) {
        try {
          const credentials = { key: fs.readFileSync(cfg.https.keyPath), cert: fs.readFileSync(cfg.https.certPath) };
          httpsServer = https.createServer(credentials, ctx.app);
          httpsServer.listen(cfg.https.port, cfg.host, () => {
            log.info('EchoClass AI HTTPS listening', { port: cfg.https.port, host: cfg.host });
          });
        } catch (err) {
          log.warn('Could not start HTTPS server', { err: err.message });
        }
      } else {
        log.warn('HTTPS enabled but certificates not found at', { key: cfg.https.keyPath, cert: cfg.https.certPath });
      }
    }

    ctx.server.listen(cfg.port, cfg.host, () => {
      log.info('EchoClass AI listening', {
        port: cfg.port,
        host: cfg.host,
        env: cfg.nodeEnv,
        mongoUri: cfg.mongoUri,
        ai: cfg.ai.provider,
        transcription: cfg.transcription.provider
      });
      const localHost = cfg.host === '0.0.0.0' ? 'localhost' : cfg.host;

      console.log('\n===============================================================');
      console.log('   EchoClass AI – Offline Classroom Assistant Running');
      console.log('===============================================================');
      console.log(`   Teacher (This Computer): http://${localHost}:${cfg.port}`);
      if (localIps.length) {
        console.log(`   Students (Classroom Wi-Fi):`);
        localIps.forEach(ip => console.log(`    -> http://${ip}:${cfg.port}`));
      }
      if (httpsServer) {
        console.log(`   HTTPS Secure Context (for remote cameras): https://${primaryLanIp}:${cfg.https.port}`);
      }
      console.log('===============================================================\n');
    });

    let stopping = false;
    const stop = (sig) => {
      if (stopping) return; stopping = true; log.info('shutting down', { sig });
      const force = setTimeout(() => process.exit(1), 10_000); force.unref();
      if (httpsServer) { try { httpsServer.close(); } catch { /* ignore */ } }
      ctx.close().then(() => process.exit(0));
    };
    process.on('SIGTERM', () => stop('SIGTERM')); process.on('SIGINT', () => stop('SIGINT'));
    process.on('unhandledRejection', (e) => log.error('unhandledRejection', { err: String(e) }));
  })().catch(err => {
    log.error('Fatal startup error', { err: err.message, stack: err.stack });
    process.exit(1);
  });
}

module.exports = { createApp, create };
