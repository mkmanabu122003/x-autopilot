const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { getUserByHandle, getUserTweets } = require('../services/x-api');
const { calculateEngagementRate } = require('../services/analytics');
const { fetchAllCompetitorTweets } = require('../services/scheduler');

// GET /api/competitors - List all competitors
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const competitors = db.prepare(`
      SELECT c.*,
        (SELECT COUNT(*) FROM competitor_tweets WHERE competitor_id = c.id) as tweet_count
      FROM competitors c
      ORDER BY c.created_at DESC
    `).all();
    res.json(competitors);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/competitors - Add a competitor
router.post('/', async (req, res) => {
  try {
    const { handle } = req.body;
    if (!handle) {
      return res.status(400).json({ error: 'handle is required' });
    }

    const db = getDb();

    // Check max accounts limit
    const maxRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('competitor_max_accounts');
    const maxAccounts = maxRow ? parseInt(maxRow.value) : 10;
    const currentCount = db.prepare('SELECT COUNT(*) as count FROM competitors').get();

    if (currentCount.count >= maxAccounts) {
      return res.status(400).json({
        error: `Maximum competitor accounts reached (${maxAccounts}). Increase the limit in settings.`
      });
    }

    // Look up user on X API
    const userData = await getUserByHandle(handle);
    if (!userData.data) {
      return res.status(404).json({ error: 'User not found on X' });
    }

    const user = userData.data;
    const result = db.prepare(`
      INSERT INTO competitors (handle, name, user_id, followers_count)
      VALUES (?, ?, ?, ?)
    `).run(
      handle.replace('@', ''),
      user.name,
      user.id,
      user.public_metrics ? user.public_metrics.followers_count : 0
    );

    res.json({
      id: result.lastInsertRowid,
      handle: handle.replace('@', ''),
      name: user.name,
      user_id: user.id,
      followers_count: user.public_metrics ? user.public_metrics.followers_count : 0
    });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint')) {
      return res.status(409).json({ error: 'Competitor already exists' });
    }
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/competitors/:id - Remove a competitor
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare('DELETE FROM competitors WHERE id = ?').run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Competitor not found' });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/competitors/:id/tweets - Get competitor's tweets
router.get('/:id/tweets', (req, res) => {
  try {
    const db = getDb();
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const tweets = db.prepare(`
      SELECT * FROM competitor_tweets
      WHERE competitor_id = ?
      ORDER BY engagement_rate DESC
      LIMIT ? OFFSET ?
    `).all(req.params.id, limit, offset);

    res.json(tweets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/competitors/fetch - Manually trigger fetch for all competitors
router.post('/fetch', async (req, res) => {
  try {
    await fetchAllCompetitorTweets();
    res.json({ success: true, message: 'Competitor tweets fetched' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
