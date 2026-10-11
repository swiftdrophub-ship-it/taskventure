# TaskVenture MVP — Production-security foundation

## Goal

Prepare the SQLite-backed TaskVenture MVP for a safe hosted deployment path by adding production configuration, secure account recovery, verification gating, abuse controls, and practical deployment requirements—without claiming a public deployment exists before a host and domain are connected.

## What was implemented

1. Added `config.js` and `.env.example` for environment-based configuration. Production boot now requires a strong `SESSION_SECRET` plus a real transactional-email configuration.
2. Added email-verification status to user records and a durable `auth_tokens` table for one-time verification and password-reset tokens.
3. Added secure token handling: random 256-bit raw tokens, SHA-256 storage, 30-minute expiry, single use, and token replacement for repeat requests.
4. Added verification gating: new accounts can sign in but cannot post or claim tasks until their email is verified.
5. Added password-reset request and reset endpoints. Requests avoid account enumeration by returning the same public response whether or not an email exists.
6. Added development-safe delivery: links are printed/returned only while `NODE_ENV` is not production. Production uses the Resend API and refuses to start without a configured sender.
7. Added rate limits for registration, login, verification, reset attempts, task creation, claims, and messages.
8. Added HTTP security headers: CSP, frame denial, no-sniff, restrictive referrer policy, permissions policy, and cross-origin opener policy.
9. Updated the client with verification, development link handling, and a password-recovery path.
10. Expanded the automated smoke test to prove security headers, verification, password reset, a new-password login, and the two-account task lifecycle.

## Why this is the right next slice

A shared database alone is not enough for a public marketplace. These changes reduce account abuse, protect account recovery, make session behavior environment-aware, and prevent an accidental production launch without key security and email prerequisites.

## Verification

- Syntax checks: `node --check config.js`, `node --check db.js`, `node --check server.js`, and `node --check app.js`
- Smoke test: temporary poster and tasker accounts verify their emails, run the complete task lifecycle, reset a password, then sign in with the new password.
- Header check: `/api/health` must return frame denial and a Content Security Policy.

## Still outside this slice

A connected host/domain, persistent encrypted production storage and tested backups, real transactional email sender authentication, managed monitoring, payments/payouts, identity/safety tooling, moderation/disputes, photo storage, real-time messaging, precise locations, privacy/legal terms, and native iOS/Android packaging.
