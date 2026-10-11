/* TaskVenture runtime configuration. Copy .env.example values into your hosting provider's secret manager. */
const crypto = require('crypto');

const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || (isProduction ? '0.0.0.0' : '127.0.0.1');
const publicAppUrl = (process.env.PUBLIC_APP_URL || `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`).replace(/\/$/, '');
const sessionSecret = process.env.SESSION_SECRET || (isProduction ? '' : crypto.randomBytes(32).toString('hex'));

if (isProduction && sessionSecret.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters in production.');
}
if (isProduction && (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM)) {
  throw new Error('RESEND_API_KEY and EMAIL_FROM are required in production for verification and password-reset email.');
}

module.exports = {
  isProduction,
  host,
  port,
  publicAppUrl,
  sessionSecret,
  cookieSecure: process.env.COOKIE_SECURE === 'true' || isProduction,
  trustProxy: process.env.TRUST_PROXY === 'true',
  emailFrom: process.env.EMAIL_FROM || '',
  resendApiKey: process.env.RESEND_API_KEY || '',
};
