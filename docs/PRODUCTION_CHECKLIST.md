# Production checklist

Tick each item yourself; nothing below was verified against a live deployment by the author.

**Secrets & access**
- [ ] `JWT_SECRET` ≥ 32 random chars (the server refuses to start otherwise)
- [ ] `TEACHER_INVITE_CODE` set and shared only with real teachers
- [ ] `PUBLIC_URL` set to the final https URL; `ALLOWED_ORIGINS` only if another site must call the API
- [ ] AI / transcription keys (if used) stored as host secrets, never in git

**Data**
- [ ] Persistent disk mounted at `/data`, `DATABASE_PATH=/data/echoclass.db`
- [ ] Backup scheduled (`npm run backup`, or host disk snapshots) and a restore actually rehearsed
- [ ] `DEFAULT_RETENTION_DAYS` decided with the school; privacy page matches your real practice
- [ ] Consent/notice process for recording students' typed/sign messages agreed with the school

**Platform**
- [ ] HTTPS enforced (microphone/camera need it); WebSocket upgrade on `/ws` works through your proxy
- [ ] `/health` monitored; logs collected
- [ ] Single instance only (rate limits and WebSocket rooms are in memory)
- [ ] Hand model self-hosted (`npm run fetch-model`) if students' networks block Google storage

**Quality**
- [ ] `npm test` and `npm run e2e` pass on the exact build you deploy
- [ ] Manual test on real phones, a real microphone and a real classroom
- [ ] Accessibility review with real assistive-technology users
- [ ] Human captioner / interpreter available where legally or pedagogically required
