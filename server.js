/* TaskVenture server — SQLite-backed marketplace API with local and production security controls. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TaskVentureDb, DB_FILE } = require('./db');
const config = require('./config');

const ROOT = __dirname;
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const TOKEN_TTL_MS = 1000 * 60 * 30;
const sessions = new Map();
const limits = new Map();
const db = new TaskVentureDb();

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}_${crypto.randomBytes(12).toString('hex')}`; }
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function passwordHash(password, salt = crypto.randomBytes(16).toString('hex')) { return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (err, hash) => err ? reject(err) : resolve({ salt, hash: hash.toString('hex') }))); }
async function passwordsMatch(password, user) { const candidate = await passwordHash(password, user.password.salt); return crypto.timingSafeEqual(Buffer.from(candidate.hash, 'hex'), Buffer.from(user.password.hash, 'hex')); }
function safeUser(user) { return { id: user.id, name: user.name, email: user.email, emailVerified: user.emailVerified, level: user.level, xp: user.xp, rank: user.rank, completed: user.completed, rating: user.rating }; }
function cookies(req) { return Object.fromEntries((req.headers.cookie || '').split(';').filter(Boolean).map(part => { const index = part.indexOf('='); return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))]; })); }
function clientIp(req) { return config.trustProxy ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress : req.socket.remoteAddress; }
function rateLimit(req, res, bucket, max, windowMs) { const key = `${bucket}:${clientIp(req)}`; const point = Date.now(); const entry = limits.get(key) || { count: 0, reset: point + windowMs }; if (entry.reset <= point) { entry.count = 0; entry.reset = point + windowMs; } entry.count += 1; limits.set(key, entry); res.setHeader('RateLimit-Limit', max); res.setHeader('RateLimit-Remaining', Math.max(0, max - entry.count)); if (entry.count > max) { res.setHeader('Retry-After', Math.ceil((entry.reset - point) / 1000)); error(res, 429, 'Too many requests. Please wait a few minutes and try again.'); return false; } return true; }
function currentUser(req) { const token = cookies(req).tv_session; const session = token && sessions.get(token); if (!session || session.expires < Date.now()) { if (token) sessions.delete(token); return null; } return db.getUser(session.userId); }
function sessionToken() { return crypto.createHmac('sha256', config.sessionSecret).update(crypto.randomBytes(32)).digest('base64url'); }
function setSession(res, userId) { const token = sessionToken(); sessions.set(token, { userId, expires: Date.now() + SESSION_TTL_MS }); const secure = config.cookieSecure ? '; Secure' : ''; res.setHeader('Set-Cookie', `tv_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}${secure}`); }
function clearSession(req, res) { const token = cookies(req).tv_session; if (token) sessions.delete(token); const secure = config.cookieSecure ? '; Secure' : ''; res.setHeader('Set-Cookie', `tv_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`); }
function securityHeaders(res) { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'DENY'); res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin'); res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()'); res.setHeader('Cross-Origin-Opener-Policy', 'same-origin'); res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"); }
function send(res, status, data) { securityHeaders(res); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
function error(res, status, message) { send(res, status, { error: message }); }
function body(req) { return new Promise((resolve, reject) => { let raw = ''; let tooLarge = false; req.on('data', chunk => { raw += chunk; if (raw.length > 100000) { tooLarge = true; req.destroy(); } }); req.on('end', () => { if (tooLarge) return reject(new Error('Request body is too large.')); try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('Invalid JSON body.')); } }); req.on('error', reject); }); }
function requireUser(req, res) { const user = currentUser(req); if (!user) { error(res, 401, 'Please sign in to continue.'); return null; } return user; }
function requireVerified(user, res) { if (!user.emailVerified) { error(res, 403, 'Verify your email before using marketplace actions.'); return false; } return true; }
function taskFor(taskId) { return db.getTask(taskId); }
function isParticipant(task, user) { return task.posterId === user.id || task.assignedToId === user.id; }
function notice(userId, text) { db.addNotice(userId, text); }
function publicTask(task) { return clone(task); }
function appState(user) { const permitted = db.listTasks().filter(task => task.status === 'open' || isParticipant(task, user)); const taskIds = new Set(permitted.map(task => task.id)); const messages = [...taskIds].flatMap(taskId => db.listMessages(taskId)); return { user: safeUser(user), tasks: permitted.map(publicTask), messages, notices: db.listNotices(user.id) }; }
function validatePassword(password) { if (password.length < 10 || password.length > 128) return 'Use a password between 10 and 128 characters.'; if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return 'Use a password with at least one letter and one number.'; return ''; }
function verificationLink(token) { return `${config.publicAppUrl}/?verify=${encodeURIComponent(token)}`; }
async function deliverEmail({ to, subject, text }) { if (!config.resendApiKey) { console.log(`[DEV EMAIL] To: ${to}\n${subject}\n${text}`); return { delivered: false, development: true }; }
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: config.emailFrom, to: [to], subject, text }) });
  if (!response.ok) throw new Error(`Email provider rejected the message (${response.status}).`); return { delivered: true };
}
async function issueToken(user, purpose) { const rawToken = crypto.randomBytes(32).toString('base64url'); db.createAuthToken({ id: id('auth'), userId: user.id, tokenHash: sha256(rawToken), purpose, expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString() }); const link = verificationLink(rawToken); const action = purpose === 'verify_email' ? 'Verify your TaskVenture email' : 'Reset your TaskVenture password'; const message = purpose === 'verify_email' ? `Open this link within 30 minutes to verify your TaskVenture account:\n${link}` : `Open this link within 30 minutes to reset your TaskVenture password:\n${link.replace('?verify=', '?reset=')}`; await deliverEmail({ to: user.email, subject: action, text: message }); return config.isProduction ? {} : { developmentLink: purpose === 'verify_email' ? link : link.replace('?verify=', '?reset=') };
}

async function api(req, res, url) {
  const user = currentUser(req);
  if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, database: path.basename(DB_FILE), environment: config.isProduction ? 'production' : 'development', time: now() });
  if (req.method === 'GET' && url.pathname === '/api/session') return send(res, 200, user ? { authenticated: true, state: appState(user) } : { authenticated: false });
  if (req.method === 'POST' && url.pathname === '/api/auth/register') {
    if (!rateLimit(req, res, 'register', 6, 15 * 60 * 1000)) return;
    const data = await body(req); const name = String(data.name || '').trim(); const email = String(data.email || '').trim().toLowerCase(); const password = String(data.password || ''); const passwordError = validatePassword(password);
    if (name.length < 2 || name.length > 40) return error(res, 400, 'Use a display name between 2 and 40 characters.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error(res, 400, 'Enter a valid email address.');
    if (passwordError) return error(res, 400, passwordError);
    if (db.getUserByEmail(email)) return error(res, 409, 'An account already uses that email. Sign in instead.');
    const member = db.createUser({ id: id('u'), name, email, password: await passwordHash(password), level: 1, xp: 0, rank: 'Initiate', completed: 0, rating: 'New', emailVerified: false });
    notice(member.id, 'Welcome to TaskVenture. Verify your email to unlock marketplace actions.'); const delivery = await issueToken(member, 'verify_email'); setSession(res, member.id); return send(res, 201, { state: appState(member), ...delivery });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    if (!rateLimit(req, res, 'login', 10, 15 * 60 * 1000)) return;
    const data = await body(req); const email = String(data.email || '').trim().toLowerCase(); const candidate = db.getUserByEmail(email);
    if (!candidate || candidate.password.hash === 'seed' || !(await passwordsMatch(String(data.password || ''), candidate))) return error(res, 401, 'Email or password is incorrect.');
    setSession(res, candidate.id); return send(res, 200, { state: appState(candidate) });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/verify') {
    if (!rateLimit(req, res, 'verify', 10, 15 * 60 * 1000)) return;
    const data = await body(req); const member = db.consumeAuthToken(sha256(String(data.token || '')), 'verify_email'); if (!member) return error(res, 400, 'That verification link is invalid or has expired.'); const verified = db.markEmailVerified(member.id); notice(verified.id, 'Email verified. Marketplace actions are now unlocked.'); return send(res, 200, { state: appState(verified) });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/resend-verification') {
    if (!user) return error(res, 401, 'Please sign in to continue.'); if (user.emailVerified) return send(res, 200, { message: 'Your email is already verified.' }); if (!rateLimit(req, res, 'resend-verification', 3, 15 * 60 * 1000)) return; const delivery = await issueToken(user, 'verify_email'); return send(res, 200, { message: 'Verification email sent.', ...delivery });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/request-password-reset') {
    if (!rateLimit(req, res, 'password-reset-request', 3, 15 * 60 * 1000)) return;
    const data = await body(req); const candidate = db.getUserByEmail(String(data.email || '').trim().toLowerCase()); const response = { message: 'If that email has an account, a reset link has been sent.' }; if (candidate && candidate.password.hash !== 'seed') Object.assign(response, await issueToken(candidate, 'password_reset')); return send(res, 200, response);
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/reset-password') {
    if (!rateLimit(req, res, 'password-reset', 6, 15 * 60 * 1000)) return;
    const data = await body(req); const password = String(data.password || ''); const passwordError = validatePassword(password); if (passwordError) return error(res, 400, passwordError); const member = db.consumeAuthToken(sha256(String(data.token || '')), 'password_reset'); if (!member) return error(res, 400, 'That password-reset link is invalid or has expired.'); const updated = db.updatePassword(member.id, await passwordHash(password)); notice(updated.id, 'Your password was changed.'); setSession(res, updated.id); return send(res, 200, { state: appState(updated) });
  }
  if (req.method === 'POST' && url.pathname === '/api/auth/logout') { clearSession(req, res); return send(res, 200, { ok: true }); }
  const member = requireUser(req, res); if (!member) return;
  if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, { state: appState(member) });
  if (req.method === 'POST' && url.pathname === '/api/tasks') {
    if (!requireVerified(member, res)) return; if (!rateLimit(req, res, 'create-task', 20, 60 * 60 * 1000)) return;
    const data = await body(req); const title = String(data.title || '').trim(); const description = String(data.description || '').trim(); const area = String(data.area || '').trim(); const when = String(data.when || '').trim(); const pay = Number(data.pay);
    if (!title || !description || !area || !when || !Number.isFinite(pay) || pay < 10) return error(res, 400, 'Complete all fields and use a budget of at least $10.');
    const task = db.createTask({ id: id('t'), title: title.slice(0, 80), description: description.slice(0, 500), pay: Math.round(pay * 100) / 100, category: String(data.category || 'Other').slice(0, 30), distance: 'General area', area: area.slice(0, 40), when: when.slice(0, 40), posterId: member.id, poster: member.name, rating: member.rating, status: 'open', xp: Math.max(25, Math.round(pay)), createdAt: now() });
    notice(member.id, `Your task “${task.title}” is live in ${task.area}.`); return send(res, 201, { state: appState(member), task });
  }
  const match = url.pathname.match(/^\/api\/tasks\/([^/]+)\/(claim|start|report|confirm|messages)$/); if (!match) return error(res, 404, 'API route not found.');
  const [, taskId, action] = match; const task = taskFor(taskId); if (!task) return error(res, 404, 'Task not found.');
  if (action === 'claim' && req.method === 'POST') {
    if (!requireVerified(member, res)) return; if (!rateLimit(req, res, 'claim', 20, 60 * 60 * 1000)) return;
    if (task.status !== 'open') return error(res, 409, 'This task is no longer available.'); if (task.posterId === member.id) return error(res, 403, 'You cannot claim your own task.');
    const assigned = db.assignTask(task.id, member); if (assigned.status !== 'claimed' || assigned.assignedToId !== member.id) return error(res, 409, 'This task is no longer available.'); notice(member.id, `You claimed “${task.title}.” Coordinate details with the poster.`); notice(task.posterId, `${member.name} claimed your task “${task.title}.”`); return send(res, 200, { state: appState(member), task: assigned });
  }
  if (action === 'start' && req.method === 'POST') { if (task.assignedToId !== member.id || task.status !== 'claimed') return error(res, 403, 'Only the assigned tasker can start this task.'); const updated = db.setTaskStatus(task.id, 'in_progress'); notice(task.posterId, `${member.name} started “${task.title}.”`); return send(res, 200, { state: appState(member), task: updated }); }
  if (action === 'report' && req.method === 'POST') { if (task.assignedToId !== member.id || task.status !== 'in_progress') return error(res, 403, 'Only the assigned tasker can report this task complete.'); const updated = db.setTaskStatus(task.id, 'completion_pending'); notice(task.posterId, `${member.name} reported “${task.title}” complete. Review it to issue rewards.`); return send(res, 200, { state: appState(member), task: updated }); }
  if (action === 'confirm' && req.method === 'POST') { if (task.posterId !== member.id || task.status !== 'completion_pending') return error(res, 403, 'Only the task poster can confirm this completion.'); const issued = db.issueRewards(task); if (!issued) return error(res, 409, 'Assigned tasker is missing.'); notice(issued.user.id, `Completion confirmed for “${task.title}”: +${task.xp} XP issued.`); notice(member.id, `You confirmed “${task.title}.” Rewards have been issued to ${issued.user.name}.`); return send(res, 200, { state: appState(member), task: issued.task, tasker: safeUser(issued.user), levelsGained: issued.levelsGained }); }
  if (action === 'messages') { if (!isParticipant(task, member)) return error(res, 403, 'Only task participants can access this conversation.'); if (req.method === 'GET') return send(res, 200, { messages: db.listMessages(task.id) }); if (req.method === 'POST') { if (!rateLimit(req, res, 'messages', 60, 60 * 1000)) return; const data = await body(req); const text = String(data.text || '').trim(); if (!text || text.length > 500) return error(res, 400, 'Message must be between 1 and 500 characters.'); const message = db.addMessage({ id: id('m'), taskId: task.id, fromId: member.id, from: member.name, text, createdAt: now() }); const other = task.posterId === member.id ? task.assignedToId : task.posterId; if (other) notice(other, `New message from ${member.name} about “${task.title}.”`); return send(res, 201, { message }); } }
  return error(res, 405, 'Method not allowed.');
}
function serveStatic(req, res, pathname) { const file = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, ''); const fullPath = path.resolve(ROOT, file); if (!fullPath.startsWith(ROOT) || !['.html', '.js', '.css'].includes(path.extname(fullPath))) return error(res, 404, 'Not found.'); fs.readFile(fullPath, (err, data) => { if (err) return error(res, 404, 'Not found.'); const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' }; securityHeaders(res); res.writeHead(200, { 'Content-Type': types[path.extname(fullPath)], 'Cache-Control': config.isProduction ? 'public, max-age=300' : 'no-cache' }); res.end(data); }); }
const server = http.createServer((req, res) => { const url = new URL(req.url, `http://${req.headers.host || `${config.host}:${config.port}`}`); Promise.resolve(url.pathname.startsWith('/api/') ? api(req, res, url) : serveStatic(req, res, url.pathname)).catch(err => { console.error(err); if (!res.headersSent) error(res, 500, 'Unexpected server error.'); }); });
setInterval(() => { const point = Date.now(); for (const [token, session] of sessions) if (session.expires < point) sessions.delete(token); for (const [key, entry] of limits) if (entry.reset < point) limits.delete(key); }, 60 * 60 * 1000).unref();
server.listen(config.port, config.host, () => console.log(`TaskVenture server: http://${config.host}:${config.port}\nSQLite database: ${DB_FILE}\nMode: ${config.isProduction ? 'production' : 'development'}`));
