// Minimal JSON-lines logger. Never pass passwords, tokens, tickets, audio or caption text to it.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
let threshold = LEVELS[process.env.LOG_LEVEL] ?? (process.env.NODE_ENV === 'test' ? LEVELS.silent : LEVELS.info);
const out = (lvl, msg, extra) => { if (LEVELS[lvl] >= threshold) (lvl === 'error' || lvl === 'warn' ? console.error : console.log)(JSON.stringify({ t: new Date().toISOString(), level: lvl, msg, ...extra })); };
module.exports = {
  setLevel: (l) => { threshold = LEVELS[l] ?? threshold; },
  debug: (m, e) => out('debug', m, e), info: (m, e) => out('info', m, e), warn: (m, e) => out('warn', m, e), error: (m, e) => out('error', m, e),
};
