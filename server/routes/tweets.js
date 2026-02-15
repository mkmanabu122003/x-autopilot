const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { postTweet } = require('../services/x-api');

// POST /api/tweets - New tweet
router.post('/', async (req, res) => {
  try {
    const { text, accountId, scheduledAt } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'text is required' });
    }
    if (!accountId) {
      return res.status(400).json({ error: 'accountId is required' });
    }

    const db = getDb();

    if (scheduledAt) {
      const result = db.prepare(`
        INSERT INTO my_posts (account_id, text, post_type, status, scheduled_at)
        VALUES (?, ?, 'new', 'scheduled', ?)
      `).run(accountId, text, scheduledAt);

      return res.json({
        id: result.lastInsertRowid,
        status: 'scheduled',
        scheduled_at: scheduledAt
      });
    }

    const xResult = await postTweet(text, { accountId });

    db.prepare(`
      INSERT INTO my_posts (account_id, tweet_id, text, post_type, status, posted_at)
      VALUES (?, ?, ?, 'new', 'posted', CURRENT_TIMESTAMP)
    `).run(accountId, xResult.data.id, text);

    res.json({ tweet_id: xResult.data.id, status: 'posted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tweets/reply - Reply to a tweet
router.post('/reply', async (req, res) => {
  try {
    const { text, targetTweetId, accountId, scheduledAt } = req.body;
    if (!text || !targetTweetId) {
      return res.status(400).json({ error: 'text and targetTweetId are required' });
    }
    if (!accountId) {
      return res.status(400).json({ error: 'accountId is required' });
    }

    const db = getDb();

    if (scheduledAt) {
      const result = db.prepare(`
        INSERT INTO my_posts (account_id, text, post_type, target_tweet_id, status, scheduled_at)
        VALUES (?, ?, 'reply', ?, 'scheduled', ?)
      `).run(accountId, text, targetTweetId, scheduledAt);

      return res.json({
        id: result.lastInsertRowid,
        status: 'scheduled',
        scheduled_at: scheduledAt
      });
    }

    const xResult = await postTweet(text, { accountId, replyToId: targetTweetId });

    db.prepare(`
      INSERT INTO my_posts (account_id, tweet_id, text, post_type, target_tweet_id, status, posted_at)
      VALUES (?, ?, ?, 'reply', ?, 'posted', CURRENT_TIMESTAMP)
    `).run(accountId, xResult.data.id, text, targetTweetId);

    res.json({ tweet_id: xResult.data.id, status: 'posted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tweets/quote - Quote retweet
router.post('/quote', async (req, res) => {
  try {
    const { text, targetTweetId, accountId, scheduledAt } = req.body;
    if (!text || !targetTweetId) {
      return res.status(400).json({ error: 'text and targetTweetId are required' });
    }
    if (!accountId) {
      return res.status(400).json({ error: 'accountId is required' });
    }

    const db = getDb();

    if (scheduledAt) {
      const result = db.prepare(`
        INSERT INTO my_posts (account_id, text, post_type, target_tweet_id, status, scheduled_at)
        VALUES (?, ?, 'quote', ?, 'scheduled', ?)
      `).run(accountId, text, targetTweetId, scheduledAt);

      return res.json({
        id: result.lastInsertRowid,
        status: 'scheduled',
        scheduled_at: scheduledAt
      });
    }

    const xResult = await postTweet(text, { accountId, quoteTweetId: targetTweetId });

    db.prepare(`
      INSERT INTO my_posts (account_id, tweet_id, text, post_type, target_tweet_id, status, posted_at)
      VALUES (?, ?, ?, 'quote', ?, 'posted', CURRENT_TIMESTAMP)
    `).run(accountId, xResult.data.id, text, targetTweetId);

    res.json({ tweet_id: xResult.data.id, status: 'posted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/tweets/scheduled - List scheduled posts
router.get('/scheduled', (req, res) => {
  try {
    const db = getDb();
    const accountId = req.query.accountId;

    let posts;
    if (accountId) {
      posts = db.prepare(`
        SELECT p.*, a.display_name as account_name, a.handle as account_handle, a.color as account_color
        FROM my_posts p
        LEFT JOIN x_accounts a ON p.account_id = a.id
        WHERE p.status = 'scheduled' AND p.account_id = ?
        ORDER BY p.scheduled_at ASC
      `).all(accountId);
    } else {
      posts = db.prepare(`
        SELECT p.*, a.display_name as account_name, a.handle as account_handle, a.color as account_color
        FROM my_posts p
        LEFT JOIN x_accounts a ON p.account_id = a.id
        WHERE p.status = 'scheduled'
        ORDER BY p.scheduled_at ASC
      `).all();
    }
    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tweets/schedule - Schedule a post
router.post('/schedule', (req, res) => {
  try {
    const { text, postType, targetTweetId, accountId, scheduledAt } = req.body;
    if (!text || !scheduledAt) {
      return res.status(400).json({ error: 'text and scheduledAt are required' });
    }
    if (!accountId) {
      return res.status(400).json({ error: 'accountId is required' });
    }

    const db = getDb();
    const result = db.prepare(`
      INSERT INTO my_posts (account_id, text, post_type, target_tweet_id, status, scheduled_at)
      VALUES (?, ?, ?, ?, 'scheduled', ?)
    `).run(accountId, text, postType || 'new', targetTweetId || null, scheduledAt);

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
