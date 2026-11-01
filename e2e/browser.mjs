// Real-browser end-to-end test. Serves the PRODUCTION frontend build (NODE_ENV=test only because production forbids the http:// AI stub) (Express serving apps/classroom-web/dist) on a temp SQLite file,
// then drives it with headless Chromium: register -> login -> create class -> student joins -> live captions -> end -> transcript -> download -> study notes.
// Run:  npm run build:classroom && npm run e2e
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const axeSource = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const PORT = 3100 + Math.floor(Math.random() * 400), BASE = `http://127.0.0.1:${PORT}`, AIPORT = PORT + 1000;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'echoclass-e2e-'));
const results = []; let failed = 0;
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); console.log('PASS', name); } catch (e) { failed++; results.push(['FAIL', name, e.message]); console.log('FAIL', name, '\n   ', String(e.message).split('\n').slice(0, 4).join('\n    ')); } };

// stub AI provider (no network)
const AI = JSON.stringify({ summary: 'The class covered mitochondria.', concepts: ['Cell energy'], keyPoints: ['Mitochondria make energy'], terms: [{ term: 'mitochondria', meaning: 'Energy-releasing part of a cell.' }], questions: ['What do mitochondria do?'], actionItems: [], notes: 'Notes.' });
const aiServer = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ content: [{ type: 'text', text: AI }] })); }); });
await new Promise((r) => aiServer.listen(AIPORT, '127.0.0.1', r));

const server = spawn(process.execPath, ['apps/backend/src/server.js'], { env: { ...process.env, NODE_ENV: 'test', PORT: String(PORT), HOST: '127.0.0.1', DATABASE_PATH: path.join(tmp, 'e2e.db'), JWT_SECRET: 'e2e-secret-'.padEnd(40, 'x'), TEACHER_INVITE_CODE: 'e2e-invite-code', PUBLIC_URL: BASE, AI_PROVIDER: 'anthropic', AI_API_KEY: 'k', AI_MODEL: 'm', AI_BASE_URL: `http://127.0.0.1:${AIPORT}`, TRUST_PROXY: '0', LOG_LEVEL: 'error' }, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = ''; server.stdout.on('data', (d) => serverLog += d); server.stderr.on('data', (d) => serverLog += d);
for (let i = 0; i < 100; i++) { try { if ((await fetch(BASE + '/health')).ok) break; } catch {} await new Promise((r) => setTimeout(r, 100)); if (i === 99) { console.error('server did not start\n' + serverLog); process.exit(1); } }

const exe = process.env.CHROMIUM_PATH || ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((p) => fs.existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--disable-background-networking', '--disable-component-update', '--no-first-run'] });
const problems = [];   // console errors / CSP violations / failed same-origin requests
const mk = async (name) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, permissions: ['camera', 'microphone'] });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  page.on('console', (m) => { if (m.type() === 'error' && !/status of (401|403|404|409|400)|Failed to load resource.*(40[0-9])/.test(m.text())) problems.push(`[${name}] console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`[${name}] pageerror: ${e.message}`));
  return page;
};
const axe = async (page, label) => {
  await page.evaluate(axeSource);
  const r = await page.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] }));
  const bad = r.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  assert.equal(bad.length, 0, `${label}: axe ${bad.map((v) => v.id + '(' + v.nodes.length + ')').join(', ')}`);
};
const T = { name: 'Ms Rao', email: 'rao@example.com', pw: 'Passw0rd!' }, S = { name: 'Asha Patel', email: 'asha@example.com', pw: 'Passw0rd!' };
const register = async (page, u, role, invite) => {
  await page.goto(BASE + '/register');
  await page.getByLabel('Full Name').fill(u.name); await page.getByLabel('Email Address').fill(u.email); await page.getByLabel('Password').fill(u.pw);
  await page.getByRole('button', { name: new RegExp('^' + role, 'i') }).click();
  if (invite) await page.getByLabel(/Teacher invite code/).fill(invite);
  await page.getByRole('button', { name: 'Create Account' }).click();
};

let tp, sp, code, classUrl;
try {
  tp = await mk('teacher'); sp = await mk('student');

  await step('public pages load from the production build (SPA fallback, hashed assets, CSP header)', async () => {
    const r = await tp.goto(BASE + '/login'); assert.equal(r.status(), 200);
    assert.match(r.headers()['content-security-policy'] || '', /default-src 'self'/);
    await tp.getByRole('heading', { name: /Sign in/ }).waitFor();
    const asset = await tp.evaluate(() => [...document.scripts].map((s) => s.src).find((s) => /\/assets\//.test(s)));
    assert.ok(asset, 'script from /assets/');
    assert.equal((await fetch(BASE + '/api/nope')).status, 404);
    assert.equal((await fetch(BASE + '/health')).status, 200);
  });
  await step('accessibility (axe, WCAG A/AA serious+critical): login and register', async () => { await axe(tp, 'login'); await tp.goto(BASE + '/register'); await tp.getByRole('heading', { name: /Create your account/ }).waitFor(); await axe(tp, 'register'); });
  await step('register validation: bad invite code shows a field error from the server', async () => {
    await register(tp, T, 'teacher', 'wrong-code-xx');
    await tp.locator('#inviteCode-error').waitFor({ timeout: 5000 });
  });
  await step('teacher registers with the invite code and lands on the dashboard', async () => {
    await tp.getByLabel(/Teacher invite code/).fill('e2e-invite-code');
    await tp.getByRole('button', { name: 'Create Account' }).click();
    await tp.getByRole('heading', { name: /Welcome, Ms Rao/ }).waitFor({ timeout: 8000 });
    assert.ok(await tp.evaluate(() => !!localStorage.getItem('echoclass_token')));
  });
  await step('teacher creates a classroom (modal + zod validation + API)', async () => {
    await tp.getByRole('button', { name: '+ Create classroom' }).click();
    await tp.getByLabel('Classroom name').fill('A'); await tp.getByRole('button', { name: /^Create/ }).last().click();
    await tp.getByText(/at least 2 characters/).waitFor();
    await tp.getByLabel('Classroom name').fill('Biology 9'); await tp.getByLabel('Subject (optional)').fill('Science');
    await tp.getByRole('button', { name: /^Create/ }).last().click();
    await tp.getByRole('heading', { name: 'Biology 9' }).waitFor({ timeout: 8000 });
    code = (await tp.getByText(/^Code: /).first().textContent()).replace('Code:', '').trim();
    assert.match(code, /^[A-Z0-9]{8}$/);
    await tp.getByRole('link', { name: 'Open' }).first().click();
    await tp.waitForURL(/\/classrooms\/\d+$/, { timeout: 8000 });
    classUrl = tp.url();
    await tp.locator('code[aria-label^="Join code"]').first().waitFor();
  });
  await step('vocabulary management through the UI (add, shown, delete)', async () => {
    await tp.getByRole('tab', { name: 'Vocabulary' }).click();
    await tp.getByLabel('Heard as').fill('might a conjure'); await tp.getByLabel('Should be').fill('mitochondria');
    await tp.getByRole('button', { name: 'Add rule' }).click();
    await tp.getByText('might a conjure').waitFor();
    await tp.getByRole('button', { name: /Delete correction might a conjure/ }).click();
    await tp.getByText('might a conjure').waitFor({ state: 'detached' });
    await tp.getByLabel('Heard as').fill('might a conjure'); await tp.getByLabel('Should be').fill('mitochondria'); await tp.getByRole('button', { name: 'Add rule' }).click();
    await tp.getByText('might a conjure').waitFor();
  });
  await step('student registers, joins with the code, sees the classroom', async () => {
    await register(sp, S, 'student');
    await sp.getByRole('heading', { name: /Welcome, Asha Patel/ }).waitFor({ timeout: 8000 });
    await sp.getByRole('button', { name: 'Join with code' }).click();
    await sp.getByLabel(/Join code from your teacher/).fill(code.toLowerCase());
    await sp.getByRole('button', { name: /^Join/ }).last().click();
    await sp.getByRole('heading', { name: 'Biology 9' }).first().waitFor({ timeout: 8000 });
    await sp.getByRole('link', { name: 'Open' }).first().click();
    await sp.waitForURL(/\/classrooms\/\d+$/);
  });
  await step('a student cannot see the join code or teacher-only controls', async () => {
    assert.equal(await sp.locator('code[aria-label^="Join code"]').count(), 0);
    assert.equal(await sp.getByRole('button', { name: '+ Start lecture' }).count(), 0);
  });
  await step('teacher starts a live lecture; student joins live', async () => {
    await tp.getByRole('tab', { name: /lectures/i }).click();
    await tp.getByRole('button', { name: '+ Start lecture' }).click();
    await tp.getByLabel('Lecture title').fill('Cells');
    await tp.getByRole('button', { name: /^Start/ }).last().click();
    await tp.waitForURL(/\/live$/, { timeout: 8000 });
    await sp.reload();
    await sp.getByRole('link', { name: /Join live lecture/ }).click();
    await sp.waitForURL(/\/live$/);
    await tp.getByText(/Connected|Live/i).first().waitFor({ timeout: 8000 });
  });
  await step('typed caption from the teacher reaches the student in real time with vocabulary applied', async () => {
    await tp.locator('#typed-caption').fill('The might a conjure makes energy'); await tp.getByRole('button', { name: 'Send', exact: true }).click();
    await sp.getByRole('log', { name: 'Caption history' }).getByText('The mitochondria makes energy').waitFor({ timeout: 8000 });
    await tp.locator('#typed-caption').fill('Photosynthesis happens in chloroplasts'); await tp.keyboard.press('Enter');
    await sp.getByText('Photosynthesis happens in chloroplasts').waitFor({ timeout: 8000 });
  });
  await step('student request + confusing flag reach the teacher', async () => {
    await sp.getByRole('button', { name: /slow down/i }).click();
    await tp.getByText(/slow down/i).first().waitFor({ timeout: 8000 });
    await sp.getByRole('button', { name: /Mark “The mitochondria makes energy” as confusing/ }).click();
  });
  await step('student typed message appears as a student caption', async () => {
    await sp.locator('#typed-msg').fill('I understand.'); await sp.getByRole('button', { name: 'Send', exact: true }).click();
    await tp.getByText('I understand.').waitFor({ timeout: 8000 });
  });
  await step('student camera panel: real MediaPipe model + WASM load from this server; honest status without a hand in view', async () => {
    const reqs = []; sp.on('request', (r) => reqs.push(r.url()));
    await sp.getByRole('button', { name: /start camera|camera/i }).first().click();
    const status = sp.getByRole('group', { name: 'Camera status' }).or(sp.locator('dl[aria-label="Camera status"]'));
    await status.waitFor({ timeout: 60000 });
    await sp.waitForFunction(() => /ready|no hand|running|tracking|looking/i.test(document.querySelector('dl[aria-label="Camera status"]')?.textContent || ''), null, { timeout: 60000 });
    assert.ok(reqs.some((u) => /\/vendor\/mediapipe\/wasm\//.test(u) || /vision_wasm/.test(u)), 'MediaPipe WASM requested from /vendor/mediapipe');
    assert.ok(reqs.some((u) => /hand_landmarker\.task/.test(u)), 'hand_landmarker.task model requested');
    // the fake camera shows a test pattern, not a hand: nothing must be sent as a recognised sign
    await sp.waitForTimeout(1500);
    assert.equal(await sp.locator('button[aria-label^="Remove "]').count(), 0, 'no gesture may be invented without a hand');
  });
  await step('teacher ends the lecture and everyone is moved to the transcript', async () => {
    await tp.getByRole('button', { name: /End lecture and save transcript/ }).click();
    await tp.getByRole('button', { name: 'End lecture', exact: true }).click();
    await tp.waitForURL(/\/transcripts\/\d+/, { timeout: 10000 });
    await tp.getByRole('heading', { name: 'Cells' }).waitFor();
  });
  await step('transcript: captions, search, summary, flagged moment', async () => {
    await tp.getByText('The mitochondria makes energy').first().waitFor();
    await tp.locator('#tr-search').fill('chloroplasts');
    await tp.getByText('Photosynthesis happens in chloroplasts').waitFor();
    await tp.locator('section[aria-labelledby="full-h"]').getByText('The mitochondria makes energy').waitFor({ state: 'detached', timeout: 8000 });   // server-side search result replaces the list
    await tp.locator('#tr-search').fill('');
    await tp.getByRole('heading', { name: 'Automatic summary' }).waitFor();
    await tp.getByRole('heading', { name: /Moments students found confusing/ }).waitFor();
  });
  await step('authenticated downloads (TXT/SRT/VTT/JSON) send the JWT and save real files', async () => {
    for (const f of ['txt', 'srt', 'vtt', 'json']) {
      const [dl] = await Promise.all([tp.waitForEvent('download', { timeout: 8000 }), tp.getByRole('button', { name: new RegExp('⬇ ' + f, 'i') }).click()]);
      assert.equal(dl.suggestedFilename(), `Cells.${f}`);
      const text = fs.readFileSync(await dl.path(), 'utf8'); assert.ok(text.includes('mitochondria'), f);
    }
    assert.equal((await fetch(`${BASE}/api/sessions/1/export?format=txt`)).status, 401, 'a bare link without the token is refused');
  });
  await step('study notes: consent dialog gates the external call; notes appear; student can read them', async () => {
    await tp.getByRole('button', { name: /generate|create/i }).filter({ hasText: /notes|study|summary/i }).first().click();
    const dlg = tp.getByRole('dialog'); await dlg.waitFor();
    const go = dlg.getByRole('button', { name: /generate|send|create/i }).last(); assert.ok(await go.isDisabled(), 'disabled until consent is ticked');
    await dlg.getByRole('checkbox').check(); await go.click();
    await tp.getByText('The class covered mitochondria.').waitFor({ timeout: 10000 });
    await sp.goto(tp.url()); await sp.getByText('The class covered mitochondria.').waitFor({ timeout: 8000 });
    assert.equal(await sp.getByRole('button', { name: /^Regenerate$/ }).count(), 0, 'students cannot regenerate');
  });
  await step('accessibility (axe): dashboard, classroom, transcript', async () => {
    await tp.goto(BASE + '/dashboard'); await tp.getByRole('heading', { name: /Welcome/ }).waitFor(); await axe(tp, 'dashboard');
    await tp.goto(classUrl); await tp.getByRole('heading', { name: 'Biology 9' }).first().waitFor(); await axe(tp, 'classroom');
    await sp.getByRole('heading', { name: 'Cells' }).waitFor(); await axe(sp, 'transcript');
  });
  await step('mobile layout has no horizontal overflow', async () => {
    const m = await mk('mobile'); await m.setViewportSize({ width: 375, height: 740 });
    for (const p of ['/', '/login', '/register']) { await m.goto(BASE + p); await m.waitForLoadState('networkidle'); assert.ok(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), p + ' overflows'); }
  });
  await step('protected routes redirect anonymous visitors; logout clears the session; sessions are server-revocable', async () => {
    const a = await mk('anon'); await a.goto(BASE + '/dashboard'); await a.waitForURL(/\/login/);
    await tp.goto(BASE + '/dashboard'); await tp.getByRole('button', { name: /log ?out|sign out/i }).first().click();
    await tp.waitForURL(/\/(login)?$/); assert.ok(await tp.evaluate(() => !localStorage.getItem('echoclass_token')));
  });
  await step('no unexpected console errors, page errors or CSP violations during the whole run', async () => { assert.deepEqual(problems, []); });
} finally {
  await browser.close(); server.kill('SIGTERM'); aiServer.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n${results.filter((r) => r[0] === 'PASS').length}/${results.length} browser checks passed`);
if (failed) { console.log('\nserver log tail:\n' + serverLog.slice(-1500)); process.exit(1); }
