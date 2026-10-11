# TaskVenture deployment on Railway

This repository is ready to deploy as one Railway service. It currently uses SQLite, so **a Railway Volume is required** before public use.

## 1. Create the service

1. Create a Railway project and add a service from this repository.
2. Railway reads `railway.json` and starts the app with `node server.js`.
3. Add a Railway Volume to the service. Set its mount path to:

   ```text
   /data
   ```

   Railway volumes are persistent directories. The mounted path must be supplied to the app as the database location below.

## 2. Set production variables

Create these variables in the Railway service. Values marked **secret** must be stored in Railway's secret manager, not committed.

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | Let Railway provide this automatically; do not hard-code it. |
| `PUBLIC_APP_URL` | The final HTTPS public domain, for example `https://taskventure.up.railway.app` |
| `SESSION_SECRET` | **Secret:** a unique random value of 32+ characters |
| `COOKIE_SECURE` | `true` |
| `TRUST_PROXY` | `true` |
| `TASKVENTURE_DB_FILE` | `/data/taskventure.db` |
| `RESEND_API_KEY` | **Secret:** a Resend API key |
| `EMAIL_FROM` | A verified Resend sender, for example `TaskVenture <accounts@your-domain.com>` |

The app intentionally refuses to start in production if `SESSION_SECRET`, `RESEND_API_KEY`, or `EMAIL_FROM` are absent.

## 3. Deploy and verify

1. Generate a Railway domain or attach a custom domain.
2. Set `PUBLIC_APP_URL` to that exact `https://` URL, then redeploy.
3. Visit:

   ```text
   https://YOUR-DOMAIN/api/health
   ```

   A healthy response contains `"ok": true` and the database filename.
4. Register a test account using an inbox you control. Confirm the verification email arrives and its link opens the public app.
5. Repeat with a second account to verify the cross-account claim, message, task completion, and approval flow.

## Backups and scale limits

- The `/data` volume contains user/account data. Enable Railway volume backups if available on the chosen plan, and test restoration before inviting external users.
- Run **one application replica only** while SQLite is the primary datastore. Do not enable multi-region or horizontal scaling with this database architecture.
- Before high-traffic launch, migrate to managed PostgreSQL and replace the in-memory session/rate-limit stores with shared production services.

## What this deployment does not include

This does not yet make TaskVenture ready for an open marketplace. Payments/payouts, identity/safety checks, moderation and disputes, legal/privacy terms, photo storage, real-time messaging, precise-location controls, and native mobile packaging remain separate launch milestones.

## Sources

- Railway volumes: https://docs.railway.com/volumes
- Railway configuration reference: https://docs.railway.com/config-as-code/reference
