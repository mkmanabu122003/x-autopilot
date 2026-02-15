const express = require('express');
const cors = require('cors');
const path = require('path');

// Use /tmp for SQLite in Vercel serverless environment
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = '/tmp/autopilot.sqlite';
}

const { initDatabase } = require('../server/db/database');
const tweetsRouter = require('../server/routes/tweets');
const competitorsRouter = require('../server/routes/competitors');
const analyticsRouter = require('../server/routes/analytics');
const aiRouter = require('../server/routes/ai');
const settingsRouter = require('../server/routes/settings');
const accountsRouter = require('../server/routes/accounts');

const app = express();

app.use(cors());
app.use(express.json());

// API routes
app.use('/api/accounts', accountsRouter);
app.use('/api/tweets', tweetsRouter);
app.use('/api/competitors', competitorsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/settings', settingsRouter);

// Initialize database
try {
  initDatabase();
} catch (err) {
  console.error('Database initialization error:', err.message);
}

module.exports = app;
