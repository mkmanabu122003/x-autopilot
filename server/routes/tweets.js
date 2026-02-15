const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { postTweet } = require('../services/x-api');

// POST /api/tweets - New tweet
router.post('/', async (req, res) => {
  try {
    const { text, scheduledAt } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }

    const db = getDb();

    if (scheduledAt) {
      // Schedule for later
      const result = db.prepare(`
        INSERT INTO my_posts (text, post_type, status, scheduled_at)
        VALUES (?, 'new', 'scheduled', ?)
      `).run(text, scheduledAt);

      return res.json({
        id: result.lastInsertRowid,
        status: 'scheduled',
        scheduled_at: scheduledAt
      });
    }

    // Post immediately
    const xResult = await postTweet(text);

    db.prepare(`
      INSERT INTO my_posts (tweet_id, text, post_type, status, posted_at)
      VALUES (?, ?, 'new', 'posted', CURRENT_TIMESTAMP)
    `).run(xResult.data.id, text);

    res.json({ tweet_id: xResult.data.id, status: 'posted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tweets/reply - Reply to a tweet
router.post('/reply', async (req, res) => {
  try {
    const { text, targetTweetId, scheduledAt } = req.body;
    if (!text || !targetTweetId) {
      return res.status(400).json({ error: 'text and targetTweetId are required' });
    }

    const db = getDb();

    if (scheduledAt) {
      const result = db.prepare(`
        INSERT INTO my_posts (text, post_type, target_tweet_id, status, scheduled_at)
        VALUES (?, 'reply', ?, 'scheduled', ?)
      `).run(text, targetTweetId, scheduledAt);

      return res.json({
        id: result.lastInsertRowid,
        status: 'scheduled',
        scheduled_at: scheduledAt
      });
    }

    const xResult = await postTweet(text, { replyToId: targetTweetId });

    db.prepare(`
      INSERT INTO my_posts (tweet_id, text, post_type, target_tweet_id, status, posted_at)
      VALUES (?, ?, 'reply', ?, 'posted', CURRENT_TIMESTAMP)
    `).run(xResult.data.id, text, targetTweetId);

    res.json({ tweet_id: xResult.data.id, status: 'posted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tweets/quote - Quote retweet
router.post('/quote', async (req, res) => {
  try {
    const { text, targetTweetId, scheduledAt } = req.body;
    if (!text || !targetTweetId) {
      return res.status(400).json({ error: 'text and targetTweetId are required' });
    }

    const db = getDb();

    if (scheduledAt) {
      const result = db.prepare(`
        INSERT INTO my_posts (text, post_type, target_tweet_id, status, scheduled_at)
        VALUES (?, 'quote', ?, 'scheduled', ?)
      `).run(text, targetTweetId, scheduledAt);

      return res.json({
        id: result.lastInsertRowid,
        status: 'scheduled',
        scheduled_at: scheduledAt
      });
    }

    const xResult = await postTweet(text, { quoteTweetId: targetTweetId });

    db.prepare(`
      INSERT INTO my_posts (tweet_id, text, post_type, target_tweet_id, status, posted_at)
      VALUES (?, ?, 'quote', ?, 'posted', CURRENT_TIMESTAMP)
    `).run(xResult.data.id, text, targetTweetId);

    res.json({ tweet_id: xResult.data.id, status: 'posted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/tweets/scheduled - List scheduled posts
router.get('/scheduled', (req, res) => {
  try {
    const db = getDb();
    const posts = db.prepare(`
      SELECT * FROM my_posts
      WHERE status = 'scheduled'
      ORDER BY scheduled_at ASC
    `).all();
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tweets/schedule - Schedule a post
router.post('/schedule', (req, res) => {
  try {
    const { text, postType, targetTweetId, scheduledAt } = req.body;
    if (!text || !scheduledAt) {
      return res.status(400).json({ error: 'text and scheduledAt are required' });
    }

    const db = getDb();
    const result = db.prepare(`
      INSERT INTO my_posts (text, post_type, target_tweet_id, status, scheduled_at)
      VALUES (?, ?, ?, 'scheduled', ?)
    `).run(text, postType || 'new', targetTweetId || null, scheduledAt);

    res.json({
      id: result.lastInsertRowid,
      status: 'scheduled',
      scheduled_at: scheduledAt
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/tweets/scheduled/:id - Cancel scheduled post
router.delete('/scheduled/:id', (req, res) => {
  try {
    const db = getDb();
    const result = db.prepare(`
      DELETE FROM my_posts WHERE id = ? AND status = 'scheduled'
    `).run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Scheduled post not found' });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/tweets/scheduled/:id - Edit scheduled post
router.put('/scheduled/:id', (req, res) => {
  try {
    const { text, scheduledAt } = req.body;
    const db = getDb();

    const updates = [];
    const params = [];

    if (text) {
      updates.push('text = ?');
      params.push(text);
    }
    if (scheduledAt) {
      updates.push('scheduled_at = ?');
      params.push(scheduledAt);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(req.params.id);

    const result = db.prepare(`
      UPDATE my_posts SET ${updates.join(', ')}
      WHERE id = ? AND status = 'scheduled'
    `).run(...params);

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Scheduled post not found' });
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
