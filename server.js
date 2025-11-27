// server.js
const express = require('express');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const PDFDocument = require('pdfkit');

const {
  createUser, getUserByUsername, getUserById, verifyPassword,
  insertSession, bulkInsertSessions, fetchTodayReport, fetchSessions, fetchAll,
  clearSessions, deleteSessionById
} = require('./db');

const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'replace_this_in_prod';
const app = express();

app.use(helmet());
app.use(cors());
app.use(bodyParser.json({ limit: '2mb' }));
app.use(morgan('dev'));

// --- Helpers: auth middleware (Bearer or Basic fallback) ---
function createToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  // Bearer token
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.split(' ')[1];
    try {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = getUserById(payload.id);
      if (!user) return res.status(401).json({ error: 'invalid user' });
      req.user = user;
      return next();
    } catch (e) {
      return res.status(401).json({ error: 'invalid token' });
    }
  }

  // Basic auth fallback (username:password)
  if (auth && auth.startsWith('Basic ')) {
    try {
      const creds = Buffer.from(auth.split(' ')[1], 'base64').toString('utf8');
      const [username, password] = creds.split(':');
      const userRow = getUserByUsername(username);
      if (!userRow || !verifyPassword(userRow, password)) return res.status(401).json({ error: 'invalid credentials' });
      req.user = { id: userRow.id, username: userRow.username };
      return next();
    } catch (e) {
      return res.status(401).json({ error: 'bad basic auth' });
    }
  }

  return res.status(401).json({ error: 'missing authorization' });
}

// --- Public ---
app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const existing = getUserByUsername(username);
  if (existing) return res.status(409).json({ error: 'username exists' });
  const id = createUser(username, password);
  const token = createToken({ id, username });
  res.json({ token });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'username and password required' });
  const userRow = getUserByUsername(username);
  if (!userRow || !verifyPassword(userRow, password)) return res.status(401).json({ error: 'invalid credentials' });
  const token = createToken(userRow);
  res.json({ token });
});

// --- Protected endpoints ---
app.post('/api/usage', authMiddleware, (req, res) => {
  const { source, name, seconds, label } = req.body || {};
  if (!name || (typeof seconds === 'undefined')) return res.status(400).json({ error: 'name and seconds required' });
  insertSession({ user_id: req.user.id, source: source || 'client', name, seconds: parseInt(seconds, 10) || 0, label: label || 'other' });
  res.json({ status: 'ok' });
});

app.post('/api/sync', authMiddleware, (req, res) => {
  const list = req.body?.sessions;
  if (!Array.isArray(list)) return res.status(400).json({ error: 'sessions array required' });
  // map rows with user_id
  const mapped = list.map(s => ({
    user_id: req.user.id,
    source: s.source || 'client',
    name: s.name || s.app || s.site || 'unknown',
    seconds: parseInt(s.seconds || (s.durationMin ? s.durationMin * 60 : 0), 10) || 0,
    label: s.label || 'other',
    created_at: s.createdAt || s.created_at || null
  }));
  try {
    bulkInsertSessions(mapped);
    res.json({ status: 'ok', inserted: mapped.length });
  } catch (e) {
    console.error('sync error', e);
    res.status(500).json({ error: 'db error' });
  }
});

app.get('/api/sessions', authMiddleware, (req, res) => {
  const rows = fetchSessions(req.user.id, 1000);
  res.json({ rows });
});

app.get('/api/report/today', authMiddleware, (req, res) => {
  const rows = fetchTodayReport(req.user.id);
  const totals = rows.reduce((acc, r) => { acc[r.label] = r.seconds; acc.total = (acc.total || 0) + (r.seconds || 0); return acc; }, {});
  res.json({ date: new Date().toISOString().slice(0,10), rows, totals });
});

app.get('/api/achievements', authMiddleware, (req, res) => {
  const rows = fetchTodayReport(req.user.id);
  const totals = rows.reduce((acc, r) => { acc[r.label] = r.seconds; acc.total = (acc.total || 0) + (r.seconds || 0); return acc; }, {});
  const achievements = [];
  if ((totals.study || 0) >= 30*60) achievements.push({ id: 'study_30', title: '30m Study', desc: 'Studied 30 minutes today' });
  if ((totals.total || 0) >= 60*60) achievements.push({ id: 'total_60', title: '1h Active', desc: 'Active 1 hour today' });
  res.json({ achievements, totals });
});

// PDF export
app.get('/api/export/pdf', authMiddleware, (req, res) => {
  const rows = fetchAll(req.user.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename=welltrack_${req.user.username}_${new Date().toISOString().slice(0,10)}.pdf`);
  const doc = new PDFDocument({ margin: 30 });
  doc.fontSize(18).text('WellTrack Export', { underline: true });
  doc.moveDown();
  rows.forEach(r => {
    doc.fontSize(11).text(`${r.created_at} • ${r.source} • ${r.name} • ${Math.round(r.seconds/60)} min • ${r.label}`);
  });
  doc.end();
  doc.pipe(res);
});

// Clear all sessions for the user
app.post('/api/clear', authMiddleware, (req, res) => {
  clearSessions(req.user.id);
  res.json({ status: 'cleared' });
});

// Delete a single session
app.delete('/api/session/:id', authMiddleware, (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'invalid id' });
  const info = deleteSessionById(req.user.id, id);
  res.json({ status: 'deleted', changes: info.changes });
});

// fallback 404
app.use((req, res) => res.status(404).json({ error: 'not found' }));

app.listen(PORT, () => console.log(`WellTrack backend listening on ${PORT}`));
