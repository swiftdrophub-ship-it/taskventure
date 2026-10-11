# TaskVenture MVP

A mobile-first local task marketplace prototype with an original RPG-inspired progression system.

## Current foundation

- Separate accounts can post, claim, message about, start, report, and confirm the same task.
- SQLite persists users, tasks, messages, notifications, and progression.
- Passwords are hashed with Node `scrypt`; browser sessions are HTTP-only cookies.
- New accounts require email verification before creating or claiming tasks.
- Password-reset tokens and email-verification tokens are one-time, SHA-256-hashed, and expire in 30 minutes.
- API-level authorization restricts conversations and task transitions to the appropriate task participants.
- Basic abuse controls rate-limit sign-in, registration, reset, task creation, claims, and messages.
- Security headers include CSP, frame denial, no-sniff, referrer policy, permissions policy, and cross-origin opener policy.

## Run locally

From this folder:

```cmd
node server.js
```

Then open `http://127.0.0.1:4173`.

The server creates `taskventure.db` automatically. On the first startup it imports existing development records from `taskventure-data.json`, if present. Keep both database files private and out of source control.

### Local email behavior

No email provider is required to develop locally. Verification and reset links are printed to the server terminal and returned only to the local development client so they can be tested. This behavior is disabled in production.

## Production deployment checklist

Do **not** deploy by simply copying the local database to a public web host. First:

1. Choose a host that supports a persistent volume for SQLite, or replace SQLite with a managed PostgreSQL database before multiple-server scaling.
2. Copy the values from `.env.example` into the host's secret/environment manager. Never commit an actual `.env` file.
3. Set `NODE_ENV=production`, a unique 32+ character `SESSION_SECRET`, `PUBLIC_APP_URL` with the real HTTPS domain, `COOKIE_SECURE=true`, and `TRUST_PROXY=true` when the host terminates TLS before Node.
4. Connect Resend (or replace `deliverEmail` with another transactional provider), set `RESEND_API_KEY` and a verified `EMAIL_FROM` sender domain. Production startup intentionally fails if real email delivery is absent.
5. Ensure HTTPS is handled by the host/load balancer. Secure session cookies are enabled in production.
6. Put `TASKVENTURE_DB_FILE` on the host's persistent encrypted volume and schedule daily encrypted backups. Test restoring a backup before inviting users.
7. Use a private production database with no public download path. Rotate secrets if they ever appear in a log, screenshot, commit, or chat.
8. Add managed observability and error alerts before public testing.

### Railway deployment

Railway is the selected host for the current SQLite-based MVP. Deployment configuration is included in `railway.json`; Railway will run `node server.js` and health-check `/api/health`.

Before creating the public URL, add a Railway Volume mounted at `/data`, then set `TASKVENTURE_DB_FILE=/data/taskventure.db`. Keep the service at **one replica** while SQLite is the primary database. Full setup and verification steps are in [`RAILWAY_DEPLOYMENT.md`](RAILWAY_DEPLOYMENT.md).

This workspace still has no authenticated Railway account, domain, or transactional-email account attached. The deployment can be completed as soon as the Commander signs into Railway and provides a Resend API key plus verified sender address.

## Verification

```cmd
node --check config.js
node --check db.js
node --check server.js
node --check app.js
set PORT=4179 && set TASKVENTURE_DB_FILE=taskventure-smoke.db && node server.js
```

In a second terminal:

```cmd
set BASE_URL=http://127.0.0.1:4179 && node server-smoke-test.js
```

The smoke test proves security headers, email verification, password reset, sign-in with the new password, and the two-account task lifecycle with persisted rewards.

## Files

- `config.js` — environment-aware runtime configuration and production guardrails
- `.env.example` — safe template for host secrets and deployment variables
- `db.js` — SQLite schema, token persistence, migration, and data methods
- `server.js` — API, sessions, authentication, email-token flows, rate limits, and task workflow
- `taskventure.db` — auto-created local SQLite database; private development data
- `taskventure-data.json` — legacy development data used only for one-time migration
- `index.html`, `styles.css`, `app.js` — mobile web client
- `server-smoke-test.js` — repeatable shared workflow and security test
- `TASKVENTURE_MVP_PLAN.md` — product scope and remaining marketplace work

## Still required before public marketplace testing

Hosted backups, a real sender domain, payments/payouts, identity and safety checks, moderation/disputes, photo storage, real-time messaging, push notifications, precise location controls, accessibility review, privacy/legal terms, and native iOS/Android packaging.
