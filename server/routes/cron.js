const express = require('express');
const router = express.Router();
const { processScheduledPosts } = require('../services/scheduler');
const { checkAndRunAutoPosts } = require('../services/auto-poster');

// GET /api/cron/scheduled - Process due scheduled posts
// Called by Vercel Cron or client-side polling
router.get('/scheduled', async (req, res) => {
  // Verify CRON_SECRET if set (Vercel cron sends this automatically)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    // Allow if: valid CRON_SECRET header, OR request is from internal client (no secret needed for polling)
    const isVercelCron = authHeader === `Bearer ${cronSecret}`;
    const isClientPoll = req.query.source === 'client';
    if (!isVercelCron && !isClientPoll) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

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
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.authorization;
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    await checkAndRunAutoPosts();
    res.json({ ok: true });
  } catch (err) {
    console.error('Cron /auto-post error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
