const express = require('express');
const cors = require('cors');

const { initDatabase } = require('../server/db/database');
const { initTelegramWorkflow } = require('../server/services/telegram-workflow');
const tweetsRouter = require('../server/routes/tweets');
const competitorsRouter = require('../server/routes/competitors');
const analyticsRouter = require('../server/routes/analytics');
const aiRouter = require('../server/routes/ai');
const settingsRouter = require('../server/routes/settings');
const accountsRouter = require('../server/routes/accounts');
const costsRouter = require('../server/routes/costs');
const batchRouter = require('../server/routes/batch');
const autoPostRouter = require('../server/routes/auto-post');
const growthRouter = require('../server/routes/growth');
const cronRouter = require('../server/routes/cron');
const logsRouter = require('../server/routes/logs');
const improvementRouter = require('../server/routes/improvement');
const telegramRouter = require('../server/routes/telegram');

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
app.use('/api/costs', costsRouter);
app.use('/api/batch', batchRouter);
app.use('/api/auto-post', autoPostRouter);
app.use('/api/growth', growthRouter);
app.use('/api/cron', cronRouter);
app.use('/api/logs', logsRouter);
app.use('/api/improvement', improvementRouter);
app.use('/api/telegram', telegramRouter);

// Global error handler for API routes - ensures JSON responses for all errors
// Express identifies error handlers by having exactly 4 parameters (err, req, res, next)
app.use('/api', (err, req, res, next) => {
  console.error('Unhandled API error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// Initialize database (async)
let dbInitialized = false;
const initPromise = initDatabase()
  .then(() => { dbInitialized = true; return initTelegramWorkflow(); })
  .catch(err => { console.error('Initialization error:', err.message); });

module.exports = app;
