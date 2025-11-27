// db.js
const Database = require('better-sqlite3');
const path = require('path');
const dbPath = path.join(__dirname, 'welltrack.db');
const db = new Database(dbPath);

// initialize schema
db.exec(`
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source TEXT,
  name TEXT,
  seconds INTEGER,
  label TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_created ON sessions(user_id, created_at);
`);

const bcrypt = require('bcrypt');
const SALT_ROUNDS = 10;

function createUser(username, password) {
  const hash = bcrypt.hashSync(password, SALT_ROUNDS);
  const stmt = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
  const info = stmt.run(username, hash);
  return info.lastInsertRowid;
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUserById(id) {
  return db.prepare('SELECT id, username, created_at FROM users WHERE id = ?').get(id);
}

function verifyPassword(userRow, password) {
  if(!userRow) return false;
  return bcrypt.compareSync(password, userRow.password_hash);
}

function insertSession({ user_id, source='client', name='unknown', seconds=0, label='other' }) {
  const stmt = db.prepare('INSERT INTO sessions (user_id, source, name, seconds, label) VALUES (?, ?, ?, ?, ?)');
  return stmt.run(user_id, source, name, Math.max(0, parseInt(seconds,10)||0), label);
}

function bulkInsertSessions(list) {
  const insert = db.prepare('INSERT INTO sessions (user_id, source, name, seconds, label, created_at) VALUES (?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))');
  const tx = db.transaction((rows) => {
    for(const r of rows) {
      insert.run(r.user_id, r.source, r.name, r.seconds, r.label, r.created_at || null);
    }
  });
  tx(list);
}

function fetchTodayReport(user_id) {
  const today = new Date().toISOString().slice(0,10);
  const rows = db.prepare(`
    SELECT label, SUM(seconds) as seconds, COUNT(*) as sessions
    FROM sessions
    WHERE user_id = ? AND date(created_at) = date(?)
    GROUP BY label
  `).all(user_id, today);
  return rows;
}

function fetchSessions(user_id, limit=500) {
  return db.prepare('SELECT id, source, name, seconds, label, created_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(user_id, limit);
}

function fetchAll(user_id) {
  return db.prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC').all(user_id);
}

function clearSessions(user_id) {
  return db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user_id);
}

function deleteSessionById(user_id, sessionId) {
  return db.prepare('DELETE FROM sessions WHERE user_id = ? AND id = ?').run(user_id, sessionId);
}

module.exports = {
  db,
  createUser,
  getUserByUsername,
  getUserById,
  verifyPassword,
  insertSession,
  bulkInsertSessions,
  fetchTodayReport,
  fetchSessions,
  fetchAll,
  clearSessions,
  deleteSessionById
};
