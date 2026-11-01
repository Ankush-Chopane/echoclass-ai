# Baseline report (before the EchoClass AI upgrade)

Taken from the v1 code (`echoclass-v1-original.zip` / git commit "v1 baseline (pre-upgrade)").

## What was run
| Check | Result |
|---|---|
| `npm test` (v1) | 7 of 7 passed (gesture engine + one API/WebSocket flow) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Real-browser run | v1 script passed on its own happy path |

## Gaps found by inspection (all addressed in v2 unless listed in KNOWN_LIMITATIONS in the README)
**Security**
- Anyone could register as a teacher (no gate).
- JWT carried the role; role changes/password changes did not invalidate tokens; no logout-everywhere.
- WebSocket authenticated with the JWT in the URL query string (ends up in logs/history).
- No WebSocket origin check, per-message rate limit or size limit; weak input validation.
- No login lockout, no audit log, permissive CORS, no CSP / security headers.
- `JWT_SECRET` fell back to a hard-coded value.

**Correctness / data**
- No migrations: schema was `CREATE TABLE IF NOT EXISTS` only; no indexes for common queries.
- Captions could be duplicated on reconnect (no client id / dedupe); interim lines were appended as if final.
- Transcript endpoints returned whole lectures (no pagination); search used `LIKE` over everything.
- No retention or deletion (lecture, classroom, account), no backup procedure.
- Gesture "confidence" was presented as if it were a probability.
- Speech recogniser could restart in a tight loop on repeated errors.

**UI / accessibility**
- No landing page explaining what the product does and does not do; no privacy/accessibility pages.
- Status was conveyed by colour alone in places; forms lacked programmatic error association.
- Mobile overflow on register, sticky header too tall on phones.

**Docs/deploy**
- `npm test` in README did not describe what was covered; env vars undocumented; Dockerfile had no start-period healthcheck; render.yaml had no invite code.

## Not measurable at baseline
Real-hand recognition accuracy (no dataset exists in this repository), real speech accuracy.
