const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const { initDatabase } = require('./db/database');
const { startScheduler } = require('./services/scheduler');

const tweetsRouter = require('./routes/tweets');
const competitorsRouter = require('./routes/competitors');
const analyticsRouter = require('./routes/analytics');
const aiRouter = require('./routes/ai');
const settingsRouter = require('./routes/settings');
const accountsRouter = require('./routes/accounts');
const costsRouter = require('./routes/costs');
const batchRouter = require('./routes/batch');
const autoPostRouter = require('./routes/auto-post');
const growthRouter = require('./routes/growth');
const cronRouter = require('./routes/cron');
const logsRouter = require('./routes/logs');

const basicAuth = require('./middleware/basicAuth');

const app = express();
const PORT = process.env.PORT || 3001;

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

// Global error handler for API routes - ensures JSON responses for all errors
// Express identifies error handlers by having exactly 4 parameters (err, req, res, next)
app.use('/api', (err, req, res, next) => {
  console.error('Unhandled API error:', err.message);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error'
  });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../client/dist')));
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/dist/index.html'));
  });
}

// Initialize DB and start server
(async () => {
  await initDatabase();
  startScheduler();

  app.listen(PORT, () => {
    console.log(`X AutoPilot server running on port ${PORT}`);
  });
})();

module.exports = app;
