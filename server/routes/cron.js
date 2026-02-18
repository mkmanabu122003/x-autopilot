const express = require('express');
const router = express.Router();
const { processScheduledPosts } = require('../services/scheduler');
const { checkAndRunAutoPosts } = require('../services/auto-poster');
const { logInfo, logError } = require('../services/app-logger');

// Shared auth helper – requires CRON_SECRET when it is configured
function verifyCronSecret(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true; // no secret configured → allow (dev mode)
  const authHeader = req.headers.authorization;
  if (authHeader === `Bearer ${cronSecret}`) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

// GET /api/cron/scheduled - Process due scheduled posts
// Called by Vercel Cron or external cron services (cron-job.org etc.)
router.get('/scheduled', async (req, res) => {
  if (!verifyCronSecret(req, res)) return;

  try {
    logInfo('cron', 'Cron /scheduled 実行開始');
    await processScheduledPosts();
    logInfo('cron', 'Cron /scheduled 実行完了');
    res.json({ ok: true, processed_at: new Date().toISOString() });
  } catch (err) {
    console.error('Cron /scheduled error:', err.message);
    logError('cron', 'Cron /scheduled 実行エラー', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cron/auto-post - Process auto posts
router.get('/auto-post', async (req, res) => {
  if (!verifyCronSecret(req, res)) return;

  try {
    logInfo('cron', 'Cron /auto-post 実行開始');
    await checkAndRunAutoPosts();
    logInfo('cron', 'Cron /auto-post 実行完了');
    res.json({ ok: true });
  } catch (err) {
    console.error('Cron /auto-post error:', err.message);
    logError('cron', 'Cron /auto-post 実行エラー', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports._verifyCronSecret = verifyCronSecret;
