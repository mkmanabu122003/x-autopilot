const express = require('express');
const cors = require('cors');

const { initDatabase } = require('../server/db/database');
const tweetsRouter = require('../server/routes/tweets');
const competitorsRouter = require('../server/routes/competitors');
const analyticsRouter = require('../server/routes/analytics');
const aiRouter = require('../server/routes/ai');
const settingsRouter = require('../server/routes/settings');
const accountsRouter = require('../server/routes/accounts');

const basicAuth = require('../server/middleware/basicAuth');

const app = express();

app.use(basicAuth);
app.use(cors());
app.use(express.json());

// API routes
app.use('/api/accounts', accountsRouter);
app.use('/api/tweets', tweetsRouter);
app.use('/api/competitors', competitorsRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/ai', aiRouter);
app.use('/api/settings', settingsRouter);

// Initialize database (async)
let dbInitialized = false;
const initPromise = initDatabase()
  .then(() => { dbInitialized = true; })
  .catch(err => { console.error('Database initialization error:', err.message); });

module.exports = app;
