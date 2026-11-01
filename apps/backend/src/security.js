const crypto = require('crypto');

// ---------- rate limiting (in-memory; fine for a single instance – see README for scaling notes) ----------
function createLimiter({ windowMs, max, key = (req) => req.ip, message = 'Too many requests, please slow down.' }) {
  const hits = new Map();
  const timer = setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (!v.some(x => t - x < windowMs)) hits.delete(k); }, windowMs).unref();
  const mw = (req, res, next) => {
    const k = key(req), t = Date.now(), arr = (hits.get(k) || []).filter(x => t - x < windowMs);
    if (arr.length >= max) { res.set('Retry-After', String(Math.ceil((windowMs - (t - arr[0])) / 1000))); return res.status(429).json({ error: message }); }
    arr.push(t); hits.set(k, arr); next();
  };
  mw.reset = (k) => hits.delete(k); mw.clear = () => hits.clear(); mw.stop = () => clearInterval(timer);
  return mw;
}
/** Counts only failures (e.g. wrong passwords) and locks the key out once `max` is reached within the window. */
function createFailureLock({ windowMs, max }) {
  const fails = new Map();
  const recent = (k) => (fails.get(k) || []).filter(x => Date.now() - x < windowMs);
  return {
    locked: (k) => recent(k).length >= max,
    retryAfter: (k) => { const r = recent(k); return r.length ? Math.ceil((windowMs - (Date.now() - r[0])) / 1000) : 0; },
    fail: (k) => { const r = recent(k); r.push(Date.now()); fails.set(k, r); },
    clear: (k) => fails.delete(k), clearAll: () => fails.clear(),
  };
}

// ---------- input validation ----------
const COMMON = new Set(['password', 'password1', 'password123', 'qwerty123', 'iloveyou1', 'abcd1234', 'admin123', 'welcome1', 'letmein123']);
function validatePassword(pw, { email = '', name = '' } = {}) {
  if (typeof pw !== 'string') return 'Enter a password.';
  if (pw.length < 6) return 'Password must be at least 6 characters.';
  if (Buffer.byteLength(pw) > 72) return 'Password is too long (maximum 72 bytes).';

  if (COMMON.has(pw.toLowerCase())) return 'That password is too common. Choose a different one.';
  const local = String(email).split('@')[0].toLowerCase();
  if (local.length >= 4 && pw.toLowerCase().includes(local)) return 'Password must not contain your email name.';
  return null;
}
const normalizeEmail = (e) => String(e || '').trim().toLowerCase();
const validEmail = (e) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
// eslint-disable-next-line no-control-regex
const cleanText = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const safeFilename = (s, fallback = 'transcript') => (String(s).normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 80)) || fallback;

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function randomCode(len = 8) { let s = ''; const b = crypto.randomBytes(len); for (let i = 0; i < len; i++) s += CODE_ALPHABET[b[i] % CODE_ALPHABET.length]; return s; }
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// ---------- HTTP headers ----------
function securityHeaders({ isProd }) {
  return (req, res, next) => {
    const host = req.headers.host || '';
    res.set({
      'Content-Security-Policy': [
        "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' data: https://fonts.gstatic.com",
        "img-src 'self' data: blob:", "media-src 'self' blob:", `connect-src 'self' ws://${host} wss://${host} https://storage.googleapis.com`,
        "worker-src 'self' blob:", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin',
      'Permissions-Policy': 'camera=(self), microphone=(self), geolocation=()', 'Cross-Origin-Opener-Policy': 'same-origin',
    });
    if (isProd && req.secure) res.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    next();
  };
}

async function audit(db, req, action, { userId = null, detail = null } = {}) {
  try {
    await db.collection('audit_log').insertOne({
      at: Date.now(),
      user_id: userId ?? req?.user?.id ?? null,
      action,
      ip: req?.ip || null,
      detail: detail ? String(detail).slice(0, 200) : null
    });
  } catch { /* never block a request on logging */ }
}

module.exports = { createLimiter, createFailureLock, validatePassword, normalizeEmail, validEmail, cleanText, safeFilename, randomCode, safeEqual, securityHeaders, audit };
