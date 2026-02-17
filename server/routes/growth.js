const express = require('express');
const router = express.Router();
const {
  getGrowthDashboard,
  getFollowerGrowth,
  getOwnPostsPerformance,
  getOwnWeeklyTrend,
  refreshOwnPostMetrics,
  recordFollowerSnapshot
} = require('../services/growth-analytics');

// GET /api/growth/dashboard - Growth KPIs for dashboard
router.get('/dashboard', async (req, res) => {
  try {
    const accountId = req.query.accountId;
    const data = await getGrowthDashboard(accountId);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/growth/followers - Follower growth over time
router.get('/followers', async (req, res) => {
  try {
    const accountId = req.query.accountId;
    const days = parseInt(req.query.days) || 90;
    const data = await getFollowerGrowth(accountId, days);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/growth/own-posts - Own posts with engagement metrics
router.get('/own-posts', async (req, res) => {
  try {
    const accountId = req.query.accountId;
    const limit = parseInt(req.query.limit) || 20;
    const data = await getOwnPostsPerformance(accountId, limit);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/growth/weekly-trend - Own posts weekly performance trend
router.get('/weekly-trend', async (req, res) => {
  try {
    const accountId = req.query.accountId;
    const weeks = parseInt(req.query.weeks) || 12;
    const data = await getOwnWeeklyTrend(accountId, weeks);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/growth/refresh-metrics - Manually trigger metrics refresh
router.post('/refresh-metrics', async (req, res) => {
  try {
    const accountId = req.body.accountId;
    const result = await refreshOwnPostMetrics(accountId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/growth/record-followers - Manually record follower snapshot
router.post('/record-followers', async (req, res) => {
  try {
    const accountId = req.body.accountId;
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });
    const data = await recordFollowerSnapshot(accountId);
    res.json(data || { message: 'No data recorded' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
