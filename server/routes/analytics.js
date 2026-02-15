const express = require('express');
const router = express.Router();
const {
  getDashboardSummary,
  getTopPosts,
  getHourlyPerformance,
  getWeeklyEngagement,
  getPostTypePerformance
} = require('../services/analytics');

// GET /api/analytics/dashboard - Dashboard summary data
router.get('/dashboard', (req, res) => {
  try {
    const accountId = req.query.accountId;
    const summary = getDashboardSummary(accountId);
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/top-posts - Top performing posts
router.get('/top-posts', (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const posts = getTopPosts(limit);
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/hourly - Hourly performance data
router.get('/hourly', (req, res) => {
  try {
    const data = getHourlyPerformance();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/weekly - Weekly engagement trends
router.get('/weekly', (req, res) => {
  try {
    const weeks = parseInt(req.query.weeks) || 12;
    const data = getWeeklyEngagement(weeks);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/post-types - Performance by post type
router.get('/post-types', (req, res) => {
  try {
    const data = getPostTypePerformance();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
