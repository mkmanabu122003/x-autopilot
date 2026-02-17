const express = require('express');
const router = express.Router();
const {
  getDashboardSummary,
  getTopPosts,
  getHourlyPerformance,
  getWeeklyEngagement,
  getPostTypePerformance,
  getQuoteSuggestions,
  getReplySuggestions
} = require('../services/analytics');

// GET /api/analytics/dashboard - Dashboard summary data
router.get('/dashboard', async (req, res) => {
  try {
    const accountId = req.query.accountId;
    const summary = await getDashboardSummary(accountId);
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/top-posts - Top performing posts
router.get('/top-posts', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const posts = await getTopPosts(limit);
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/hourly - Hourly performance data
router.get('/hourly', async (req, res) => {
  try {
    const data = await getHourlyPerformance();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/weekly - Weekly engagement trends
router.get('/weekly', async (req, res) => {
  try {
    const weeks = parseInt(req.query.weeks) || 12;
    const data = await getWeeklyEngagement(weeks);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/post-types - Performance by post type
router.get('/post-types', async (req, res) => {
  try {
    const data = await getPostTypePerformance();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/quote-suggestions - Recommended tweets for quote RT
router.get('/quote-suggestions', async (req, res) => {
  try {
    const accountId = req.query.accountId;
    const limit = parseInt(req.query.limit) || 10;
    const minEngagementRate = parseFloat(req.query.minEngagementRate) || 0;
    const suggestions = await getQuoteSuggestions(accountId, { limit, minEngagementRate });
    res.json(suggestions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/analytics/reply-suggestions - Recommended tweets for reply
router.get('/reply-suggestions', async (req, res) => {
  try {
    const accountId = req.query.accountId;
    const limit = parseInt(req.query.limit) || 10;
    const minEngagementRate = parseFloat(req.query.minEngagementRate) || 0;
    const suggestions = await getReplySuggestions(accountId, { limit, minEngagementRate });
    res.json(suggestions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
