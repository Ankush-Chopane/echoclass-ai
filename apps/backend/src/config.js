// Central, validated configuration. Fails fast with actionable messages instead of running half-configured.
const crypto = require('crypto');
const path = require('path');

class ConfigError extends Error { constructor(problems) { super('Invalid configuration:\n - ' + problems.join('\n - ')); this.problems = problems; } }
const PLACEHOLDERS = new Set(['change-me', 'changeme', 'secret', 'your-secret-here', 'replace-me']);

function int(env, key, def, { min = -Infinity, max = Infinity } = {}, problems) {
  if (env[key] == null || env[key] === '') return def;
  const n = Number(env[key]);
  if (!Number.isInteger(n) || n < min || n > max) { problems.push(`${key} must be an integer between ${min} and ${max} (got "${env[key]}")`); return def; }
  return n;
}
// Repo root (…/apps/backend/src -> …). User data (certs, speech model) stays at the root so existing installs keep working.
const ROOT = path.resolve(__dirname, '..', '..', '..');
const list = (v) => String(v || '').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);

function load(env = process.env, { warn = () => {} } = {}) {
  const problems = [];
  const nodeEnv = env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';
  const cfg = { nodeEnv, isProd };

  cfg.port = int(env, 'PORT', 3000, { min: 1, max: 65535 }, problems);
  cfg.host = env.HOST || '0.0.0.0';   // 0.0.0.0 so students on the classroom Wi-Fi / the hosting platform can reach the server
  cfg.staticDir = path.resolve(env.STATIC_DIR || path.join(ROOT, 'apps', 'classroom-web', 'dist'));   // built React app
  cfg.mongoUri = env.MONGODB_URI || 'mongodb://localhost:27017/echoclass';

  let secret = env.JWT_SECRET;
  if (!secret) {
    if (isProd) problems.push('JWT_SECRET is required in production. Generate one with: openssl rand -hex 32');
    else { secret = crypto.randomBytes(32).toString('hex'); warn('JWT_SECRET not set – using a random development secret (sign-ins reset on restart).'); }
  } else if (isProd && (secret.length < 32 || PLACEHOLDERS.has(secret.toLowerCase()))) {
    problems.push('JWT_SECRET must be at least 32 characters and not a placeholder. Generate one with: openssl rand -hex 32');
  }
  cfg.jwtSecret = secret;
  cfg.jwtTtlSeconds = int(env, 'JWT_TTL_SECONDS', 8 * 3600, { min: 300, max: 7 * 86400 }, problems);

  cfg.allowedOrigins = [...new Set([...list(env.ALLOWED_ORIGINS), ...list(env.PUBLIC_URL), ...list(env.RENDER_EXTERNAL_URL)])];
  cfg.trustProxy = int(env, 'TRUST_PROXY', isProd ? 1 : 0, { min: 0, max: 10 }, problems);

  cfg.teacherInviteCode = env.TEACHER_INVITE_CODE || '';
  cfg.allowOpenTeacherSignup = env.ALLOW_OPEN_TEACHER_SIGNUP === 'true' || (!isProd && !cfg.teacherInviteCode);
  if (cfg.teacherInviteCode && cfg.teacherInviteCode.length < 8) problems.push('TEACHER_INVITE_CODE must be at least 8 characters.');
  if (isProd && !cfg.teacherInviteCode && env.ALLOW_OPEN_TEACHER_SIGNUP !== 'true') problems.push('Set TEACHER_INVITE_CODE (recommended) so only invited people can register as teachers, or explicitly set ALLOW_OPEN_TEACHER_SIGNUP=true.');

  cfg.defaultRetentionDays = int(env, 'DEFAULT_RETENTION_DAYS', 0, { min: 0, max: 3650 }, problems);
  cfg.logLevel = env.LOG_LEVEL || (isProd ? 'info' : 'debug');

  cfg.https = {
    enabled: env.HTTPS_ENABLED === 'true',
    port: int(env, 'HTTPS_PORT', 3443, { min: 1, max: 65535 }, problems),
    keyPath: path.resolve(env.HTTPS_KEY_PATH || path.join(ROOT, 'data', 'certs', 'server.key')),
    certPath: path.resolve(env.HTTPS_CERT_PATH || path.join(ROOT, 'data', 'certs', 'server.crt'))
  };
  cfg.voskModelPath = path.resolve(env.VOSK_MODEL_PATH || path.join(ROOT, 'models', 'vosk'));
  cfg.pythonPath = env.PYTHON_PATH || (process.platform === 'win32' ? 'python' : 'python3');

  const provider = (name, allowed, base) => {
    const p = (env[name + '_PROVIDER'] || 'none').toLowerCase();
    if (p === 'none') return { provider: 'none' };
    if (!allowed.includes(p)) { problems.push(`${name}_PROVIDER must be one of: none, ${allowed.join(', ')}`); return { provider: 'none' }; }
    if (p === 'vosk') return { provider: 'vosk', modelPath: cfg.voskModelPath, pythonPath: cfg.pythonPath };
    const o = { provider: p, apiKey: env[name + '_API_KEY'], model: env[name + '_MODEL'], baseUrl: (env[name + '_BASE_URL'] || base[p]).replace(/\/+$/, '') };
    if (!o.apiKey) problems.push(`${name}_API_KEY is required when ${name}_PROVIDER=${p}`);
    if (!o.model) problems.push(`${name}_MODEL is required when ${name}_PROVIDER=${p} (model names change; pick one from your provider's docs)`);
    try { new URL(o.baseUrl); } catch { problems.push(`${name}_BASE_URL is not a valid URL`); }
    if (isProd && o.baseUrl && !o.baseUrl.startsWith('https://')) problems.push(`${name}_BASE_URL must use https:// in production`);
    return o;
  };
  cfg.ai = { ...provider('AI', ['anthropic', 'openai'], { anthropic: 'https://api.anthropic.com', openai: 'https://api.openai.com/v1' }),
    maxInputChars: int(env, 'AI_MAX_INPUT_CHARS', 24000, { min: 1000, max: 200000 }, problems),
    timeoutMs: int(env, 'AI_TIMEOUT_MS', 30000, { min: 1000, max: 120000 }, problems),
    dailyLimit: int(env, 'AI_DAILY_LIMIT', 200, { min: 1, max: 100000 }, problems) };
  cfg.transcription = { ...provider('TRANSCRIPTION', ['openai', 'vosk'], { openai: 'https://api.openai.com/v1' }),
    maxBytes: int(env, 'TRANSCRIPTION_MAX_BYTES', 2 * 1024 * 1024, { min: 10000, max: 25 * 1024 * 1024 }, problems),
    maxSeconds: int(env, 'TRANSCRIPTION_MAX_SECONDS', 30, { min: 1, max: 300 }, problems),
    timeoutMs: int(env, 'TRANSCRIPTION_TIMEOUT_MS', 20000, { min: 1000, max: 120000 }, problems) };

  if (problems.length) throw new ConfigError(problems);
  return cfg;
}
module.exports = { load, ConfigError, ROOT };
