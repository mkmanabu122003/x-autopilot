const express = require('express');
const router = express.Router();
const { getLogs, getLogCount, cleanOldLogs, VALID_LEVELS } = require('../services/app-logger');

// GET /api/logs - ログ一覧取得（フィルタ・ページネーション対応）
router.get('/', async (req, res) => {
  try {
    const level = req.query.level || '';
    const category = req.query.category || '';
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;

    const [logs, total] = await Promise.all([
      getLogs({ level, category, limit, offset }),
      getLogCount({ level, category })
    ]);

    res.json({ logs, total, limit, offset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/logs - 古いログを削除
router.delete('/', async (req, res) => {
  try {
    const retentionDays = parseInt(req.query.days) || 30;
    await cleanOldLogs(retentionDays);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
