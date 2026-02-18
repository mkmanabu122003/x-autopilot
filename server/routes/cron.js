const express = require('express');
const router = express.Router();
const { processScheduledPosts } = require('../services/scheduler');
const { checkAndRunAutoPosts } = require('../services/auto-poster');

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
    await processScheduledPosts();
    res.json({ ok: true, processed_at: new Date().toISOString() });
  } catch (err) {
    console.error('Cron /scheduled error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cron/auto-post - Process auto posts
router.get('/auto-post', async (req, res) => {
  if (!verifyCronSecret(req, res)) return;

  try {
    await checkAndRunAutoPosts();
    res.json({ ok: true });
  } catch (err) {
    console.error('Cron /auto-post error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports._verifyCronSecret = verifyCronSecret;
