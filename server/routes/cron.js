const express = require('express');
const router = express.Router();
const { processScheduledPosts } = require('../services/scheduler');
const { checkAndRunAutoPosts } = require('../services/auto-poster');
const { logInfo, logError, cleanOldLogs } = require('../services/app-logger');

// Shared auth helper – requires CRON_SECRET when it is configured
function verifyCronSecret(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return true; // no secret configured → allow (dev mode)
  const authHeader = req.headers.authorization;
  if (authHeader === `Bearer ${cronSecret}`) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}

// GET /api/cron/scheduled - Process due scheduled posts AND auto-post generation
// Called by Vercel Cron or external cron services (cron-job.org etc.)
// This single endpoint handles both so only one cron-job.org job is needed.
// Timeout race prevents Vercel from killing the function with a raw 504.
const CRON_TIMEOUT_MS = 110_000; // 110s — below Vercel's 120s maxDuration

router.get('/scheduled', async (req, res) => {
  if (!verifyCronSecret(req, res)) return;

  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('Cron処理がタイムアウトしました')), CRON_TIMEOUT_MS)
  );

  try {
    await Promise.race([
      (async () => {
        await logInfo('cron', 'Cron /scheduled 実行開始');

        // 0) Periodically clean old logs to prevent unbounded growth
        try {
          await cleanOldLogs(30);
        } catch (_e) { /* best-effort */ }

        // 1) Generate new auto-posts (if any schedule_times match now)
        try {
          await checkAndRunAutoPosts();
        } catch (autoPostErr) {
          console.error('Cron /scheduled: auto-post error (non-fatal):', autoPostErr.message);
          await logError('cron', 'Cron /scheduled 内の自動投稿でエラー（続行）', { error: autoPostErr.message, stack: autoPostErr.stack });
        }

        // 2) Publish due scheduled posts
        await processScheduledPosts();

        await logInfo('cron', 'Cron /scheduled 実行完了');
      })(),
      timeoutPromise
    ]);
    res.json({ ok: true, processed_at: new Date().toISOString() });
  } catch (err) {
    console.error('Cron /scheduled error:', err.message);
    await logError('cron', 'Cron /scheduled 実行エラー', { error: err.message, stack: err.stack }).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cron/auto-post - Process auto posts
router.get('/auto-post', async (req, res) => {
  if (!verifyCronSecret(req, res)) return;

  try {
    await logInfo('cron', 'Cron /auto-post 実行開始');
    await checkAndRunAutoPosts();
    await logInfo('cron', 'Cron /auto-post 実行完了');
    res.json({ ok: true });
  } catch (err) {
    console.error('Cron /auto-post error:', err.message);
    await logError('cron', 'Cron /auto-post 実行エラー', { error: err.message, stack: err.stack });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports._verifyCronSecret = verifyCronSecret;
