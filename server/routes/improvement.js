const express = require('express');
const router = express.Router();
const {
  analyzePostPerformance,
  generateImprovementInsights,
  getLatestAnalysis,
  getAnalysisHistory,
  autoAdjustSettings
} = require('../services/tweet-improver');

// GET /api/improvement/analysis - Get latest analysis for an account
router.get('/analysis', async (req, res) => {
  try {
    const accountId = req.query.accountId;
    const latest = await getLatestAnalysis(accountId);
    if (!latest) {
      return res.json({ status: 'no_data', message: 'まだ分析が実行されていません' });
    }
    res.json(latest);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/improvement/history - Get analysis history
router.get('/history', async (req, res) => {
  try {
    const accountId = req.query.accountId;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const data = await getAnalysisHistory(accountId, limit);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/improvement/analyze - Trigger a new performance analysis
router.post('/analyze', async (req, res) => {
  try {
    const { accountId, provider } = req.body;
    const result = await generateImprovementInsights(accountId, provider);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/improvement/auto-adjust - Auto-adjust settings based on performance
router.post('/auto-adjust', async (req, res) => {
  try {
    const { accountId } = req.body;
    if (!accountId) {
      return res.status(400).json({ error: 'accountId is required' });
    }
    const result = await autoAdjustSettings(accountId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/improvement/performance - Get raw performance analysis without AI
router.get('/performance', async (req, res) => {
  try {
    const accountId = req.query.accountId;
    const result = await analyzePostPerformance(accountId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
