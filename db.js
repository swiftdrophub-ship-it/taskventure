/* TaskVenture SQLite data layer — local production-style persistence without external dependencies. */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = __dirname;
const DB_FILE = process.env.TASKVENTURE_DB_FILE || path.join(ROOT, 'taskventure.db');
const LEGACY_FILE = path.join(ROOT, 'taskventure-data.json');

function now() { return new Date().toISOString(); }

class TaskVentureDb {
  constructor() {
    this.db = new DatabaseSync(DB_FILE);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
    this.migrate();
    this.migrateLegacyJson();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        level INTEGER NOT NULL DEFAULT 1,
        xp INTEGER NOT NULL DEFAULT 0,
        rank TEXT NOT NULL DEFAULT 'Initiate',
        completed INTEGER NOT NULL DEFAULT 0,
        rating TEXT NOT NULL DEFAULT 'New',
        email_verified INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        pay REAL NOT NULL,
        category TEXT NOT NULL,
        distance TEXT,
        area TEXT,
        task_when TEXT NOT NULL,
        poster_id TEXT NOT NULL REFERENCES users(id),
        poster TEXT NOT NULL,
        rating TEXT NOT NULL,
        status TEXT NOT NULL,
        xp INTEGER NOT NULL,
        assigned_to_id TEXT REFERENCES users(id),
        assigned_to TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status);
      CREATE INDEX IF NOT EXISTS tasks_poster_idx ON tasks(poster_id);
      CREATE INDEX IF NOT EXISTS tasks_assigned_idx ON tasks(assigned_to_id);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        from_id TEXT NOT NULL REFERENCES users(id),
        from_name TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS messages_task_idx ON messages(task_id, created_at);
      CREATE TABLE IF NOT EXISTS notices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS notices_user_idx ON notices(user_id, created_at DESC);
      CREATE TABLE IF NOT EXISTS auth_tokens (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'password_reset')),
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS auth_tokens_lookup_idx ON auth_tokens(token_hash, purpose, expires_at);
    `);
    const userColumns = this.db.prepare('PRAGMA table_info(users)').all().map(column => column.name);
    if (!userColumns.includes('email_verified')) this.db.exec('ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0');
  }

  migrateLegacyJson() {
    const alreadyMigrated = this.db.prepare('SELECT COUNT(*) AS count FROM users').get().count > 0;
    if (alreadyMigrated) return;
    let legacy;
    try { legacy = JSON.parse(fs.readFileSync(LEGACY_FILE, 'utf8')); } catch { return; }
    const insertUser = this.db.prepare(`INSERT OR IGNORE INTO users (id,name,email,password_salt,password_hash,level,xp,rank,completed,rating,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
    const insertTask = this.db.prepare(`INSERT OR IGNORE INTO tasks (id,title,description,pay,category,distance,area,task_when,poster_id,poster,rating,status,xp,assigned_to_id,assigned_to,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const insertMessage = this.db.prepare(`INSERT OR IGNORE INTO messages (id,task_id,from_id,from_name,text,created_at) VALUES (?,?,?,?,?,?)`);
    const insertNotice = this.db.prepare(`INSERT INTO notices (user_id,text,created_at) VALUES (?,?,?)`);
    this.db.exec('BEGIN');
    try {
      for (const user of legacy.users || []) insertUser.run(user.id, user.name, user.email, user.password?.salt || '', user.password?.hash || '', user.level || 1, user.xp || 0, user.rank || 'Initiate', user.completed || 0, user.rating || 'New', user.createdAt || now());
      for (const task of legacy.tasks || []) insertTask.run(task.id, task.title, task.description, task.pay, task.category, typeof task.distance === 'number' ? String(task.distance) : task.distance || null, task.area || null, task.when, task.posterId, task.poster, task.rating, task.status, task.xp, task.assignedToId || null, task.assignedTo || null, task.createdAt || now(), task.completedAt || null);
      for (const message of legacy.messages || []) insertMessage.run(message.id, message.taskId, message.fromId, message.from, message.text, message.createdAt || now());
      for (const [userId, notices] of Object.entries(legacy.notices || {})) for (const text of notices || []) insertNotice.run(userId, text, now());
      this.db.exec('COMMIT');
      console.log(`Migrated existing TaskVenture development data to ${path.basename(DB_FILE)}.`);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  rowUser(row) { return row && { id: row.id, name: row.name, email: row.email, password: { salt: row.password_salt, hash: row.password_hash }, level: row.level, xp: row.xp, rank: row.rank, completed: row.completed, rating: row.rating, emailVerified: Boolean(row.email_verified) }; }
  rowTask(row) { return row && { id: row.id, title: row.title, description: row.description, pay: row.pay, category: row.category, distance: row.distance !== null && /^\d+(\.\d+)?$/.test(row.distance) ? Number(row.distance) : row.distance, area: row.area, when: row.task_when, posterId: row.poster_id, poster: row.poster, rating: row.rating, status: row.status, xp: row.xp, assignedToId: row.assigned_to_id, assignedTo: row.assigned_to, createdAt: row.created_at, completedAt: row.completed_at }; }
  rowMessage(row) { return row && { id: row.id, taskId: row.task_id, fromId: row.from_id, from: row.from_name, text: row.text, createdAt: row.created_at }; }

  getUser(id) { return this.rowUser(this.db.prepare('SELECT * FROM users WHERE id = ?').get(id)); }
  getUserByEmail(email) { return this.rowUser(this.db.prepare('SELECT * FROM users WHERE email = ?').get(email)); }
  createUser(user) { this.db.prepare(`INSERT INTO users (id,name,email,password_salt,password_hash,level,xp,rank,completed,rating,email_verified,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(user.id, user.name, user.email, user.password.salt, user.password.hash, user.level, user.xp, user.rank, user.completed, user.rating, user.emailVerified ? 1 : 0, now()); return this.getUser(user.id); }
  updatePassword(userId, password) { this.db.prepare('UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?').run(password.salt, password.hash, userId); return this.getUser(userId); }
  markEmailVerified(userId) { this.db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(userId); return this.getUser(userId); }
  createAuthToken({ id, userId, tokenHash, purpose, expiresAt }) { this.db.prepare('DELETE FROM auth_tokens WHERE user_id = ? AND purpose = ?').run(userId, purpose); this.db.prepare('INSERT INTO auth_tokens (id,user_id,token_hash,purpose,expires_at,created_at) VALUES (?,?,?,?,?,?)').run(id, userId, tokenHash, purpose, expiresAt, now()); }
  consumeAuthToken(tokenHash, purpose) { const row = this.db.prepare(`SELECT * FROM auth_tokens WHERE token_hash = ? AND purpose = ? AND used_at IS NULL AND expires_at > ?`).get(tokenHash, purpose, now()); if (!row) return null; this.db.prepare('UPDATE auth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL').run(now(), row.id); return this.getUser(row.user_id); }
  getTask(id) { return this.rowTask(this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id)); }
  listTasks() { return this.db.prepare('SELECT * FROM tasks ORDER BY created_at DESC').all().map(row => this.rowTask(row)); }
  createTask(task) { this.db.prepare(`INSERT INTO tasks (id,title,description,pay,category,distance,area,task_when,poster_id,poster,rating,status,xp,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(task.id, task.title, task.description, task.pay, task.category, task.distance === undefined ? null : String(task.distance), task.area || null, task.when, task.posterId, task.poster, task.rating, task.status, task.xp, task.createdAt); return this.getTask(task.id); }
  assignTask(taskId, user) { this.db.prepare(`UPDATE tasks SET status = 'claimed', assigned_to_id = ?, assigned_to = ? WHERE id = ? AND status = 'open'`).run(user.id, user.name, taskId); return this.getTask(taskId); }
  setTaskStatus(taskId, status, completed = false) { this.db.prepare('UPDATE tasks SET status = ?, completed_at = ? WHERE id = ?').run(status, completed ? now() : null, taskId); return this.getTask(taskId); }
  issueRewards(task) {
    const user = this.getUser(task.assignedToId);
    if (!user) return null;
    const startingLevel = user.level;
    let xp = user.xp + task.xp;
    let level = user.level;
    let rank = user.rank;
    while (xp >= 500) { xp -= 500; level += 1; rank = level >= 4 ? 'Pathfinder' : 'Rising Hand'; }
    this.db.exec('BEGIN');
    try {
      this.db.prepare(`UPDATE tasks SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'completion_pending'`).run(now(), task.id);
      this.db.prepare('UPDATE users SET xp = ?, level = ?, rank = ?, completed = completed + 1 WHERE id = ?').run(xp, level, rank, user.id);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return { user: this.getUser(user.id), levelsGained: level - startingLevel, task: this.getTask(task.id) };
  }
  listMessages(taskId) { return this.db.prepare('SELECT * FROM messages WHERE task_id = ? ORDER BY created_at ASC').all(taskId).map(row => this.rowMessage(row)); }
  addMessage(message) { this.db.prepare('INSERT INTO messages (id,task_id,from_id,from_name,text,created_at) VALUES (?,?,?,?,?,?)').run(message.id, message.taskId, message.fromId, message.from, message.text, message.createdAt); return message; }
  addNotice(userId, text) { this.db.prepare('INSERT INTO notices (user_id,text,created_at) VALUES (?,?,?)').run(userId, text, now()); this.db.prepare(`DELETE FROM notices WHERE user_id = ? AND id NOT IN (SELECT id FROM notices WHERE user_id = ? ORDER BY id DESC LIMIT 20)`).run(userId, userId); }
  listNotices(userId) { return this.db.prepare('SELECT text FROM notices WHERE user_id = ? ORDER BY id DESC LIMIT 20').all(userId).map(row => row.text); }
}

module.exports = { TaskVentureDb, DB_FILE };
