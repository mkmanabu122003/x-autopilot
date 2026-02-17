const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { postTweet } = require('../services/x-api');

// POST /api/tweets - New tweet
router.post('/', async (req, res) => {
  try {
    const { text, accountId, scheduledAt } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });

    const sb = getDb();

    if (scheduledAt) {
      const { data, error } = await sb.from('my_posts').insert({
        account_id: accountId, text, post_type: 'new', status: 'scheduled', scheduled_at: scheduledAt
      }).select('id').single();
      if (error) throw error;
      return res.json({ id: data.id, status: 'scheduled', scheduled_at: scheduledAt });
    }

    const xResult = await postTweet(text, { accountId });
    const { error } = await sb.from('my_posts').insert({
      account_id: accountId, tweet_id: xResult.data.id, text, post_type: 'new', status: 'posted', posted_at: new Date().toISOString()
    });
    if (error) throw error;
    res.json({ tweet_id: xResult.data.id, status: 'posted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tweets/reply - Reply to a tweet
router.post('/reply', async (req, res) => {
  try {
    const { text, targetTweetId, accountId, scheduledAt } = req.body;
    if (!text || !targetTweetId) return res.status(400).json({ error: 'text and targetTweetId are required' });
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });

    const sb = getDb();

    if (scheduledAt) {
      const { data, error } = await sb.from('my_posts').insert({
        account_id: accountId, text, post_type: 'reply', target_tweet_id: targetTweetId, status: 'scheduled', scheduled_at: scheduledAt
      }).select('id').single();
      if (error) throw error;
      return res.json({ id: data.id, status: 'scheduled', scheduled_at: scheduledAt });
    }

    const xResult = await postTweet(text, { accountId, replyToId: targetTweetId });
    const { error } = await sb.from('my_posts').insert({
      account_id: accountId, tweet_id: xResult.data.id, text, post_type: 'reply', target_tweet_id: targetTweetId, status: 'posted', posted_at: new Date().toISOString()
    });
    if (error) throw error;
    res.json({ tweet_id: xResult.data.id, status: 'posted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tweets/quote - Quote retweet
router.post('/quote', async (req, res) => {
  try {
    const { text, targetTweetId, accountId, scheduledAt } = req.body;
    if (!text || !targetTweetId) return res.status(400).json({ error: 'text and targetTweetId are required' });
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });

    const sb = getDb();

    if (scheduledAt) {
      const { data, error } = await sb.from('my_posts').insert({
        account_id: accountId, text, post_type: 'quote', target_tweet_id: targetTweetId, status: 'scheduled', scheduled_at: scheduledAt
      }).select('id').single();
      if (error) throw error;
      return res.json({ id: data.id, status: 'scheduled', scheduled_at: scheduledAt });
    }

    const xResult = await postTweet(text, { accountId, quoteTweetId: targetTweetId });
    const { error } = await sb.from('my_posts').insert({
      account_id: accountId, tweet_id: xResult.data.id, text, post_type: 'quote', target_tweet_id: targetTweetId, status: 'posted', posted_at: new Date().toISOString()
    });
    if (error) throw error;
    res.json({ tweet_id: xResult.data.id, status: 'posted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/tweets/scheduled - List scheduled posts
router.get('/scheduled', async (req, res) => {
  try {
    const sb = getDb();
    const accountId = req.query.accountId;

    let query = sb.from('my_posts')
      .select('*, x_accounts(display_name, handle, color)')
      .eq('status', 'scheduled')
      .order('scheduled_at', { ascending: true });

    if (accountId) {
      query = query.eq('account_id', accountId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const posts = (data || []).map(p => ({
      ...p,
      account_name: p.x_accounts?.display_name,
      account_handle: p.x_accounts?.handle,
      account_color: p.x_accounts?.color,
      x_accounts: undefined
    }));

    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tweets/schedule - Schedule a post
router.post('/schedule', async (req, res) => {
  try {
    const { text, postType, targetTweetId, accountId, scheduledAt } = req.body;
    if (!text || !scheduledAt) return res.status(400).json({ error: 'text and scheduledAt are required' });
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });

    const sb = getDb();
    const { data, error } = await sb.from('my_posts').insert({
      account_id: accountId, text, post_type: postType || 'new',
      target_tweet_id: targetTweetId || null, status: 'scheduled', scheduled_at: scheduledAt
    }).select('id').single();
    if (error) throw error;

    res.json({ id: data.id, status: 'scheduled', scheduled_at: scheduledAt });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/tweets/scheduled/:id - Cancel scheduled post
router.delete('/scheduled/:id', async (req, res) => {
  try {
    const sb = getDb();
    const { data, error } = await sb.from('my_posts')
      .delete()
      .eq('id', req.params.id)
      .eq('status', 'scheduled')
      .select('id');
    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Scheduled post not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/tweets/scheduled/:id - Edit scheduled post
router.put('/scheduled/:id', async (req, res) => {
  try {
    const { text, scheduledAt } = req.body;
    const updates = {};
    if (text) updates.text = text;
    if (scheduledAt) updates.scheduled_at = scheduledAt;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const sb = getDb();
    const { data, error } = await sb.from('my_posts')
      .update(updates)
      .eq('id', req.params.id)
      .eq('status', 'scheduled')
      .select('id');
    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Scheduled post not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/tweets/drafts - List draft posts
router.get('/drafts', async (req, res) => {
  try {
    const sb = getDb();
    const accountId = req.query.accountId;

    let query = sb.from('my_posts')
      .select('*, x_accounts(display_name, handle, color)')
      .eq('status', 'draft')
      .order('created_at', { ascending: false });

    if (accountId) {
      query = query.eq('account_id', accountId);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Fetch target tweet info for reply/quote drafts
    const targetTweetIds = (data || [])
      .map(p => p.target_tweet_id)
      .filter(Boolean);

    let targetTweetMap = {};
    if (targetTweetIds.length > 0) {
      const { data: targetTweets } = await sb.from('competitor_tweets')
        .select('tweet_id, text, competitor_id, competitors(handle, name)')
        .in('tweet_id', targetTweetIds);
      if (targetTweets) {
        for (const t of targetTweets) {
          targetTweetMap[t.tweet_id] = {
            text: t.text,
            handle: t.competitors?.handle,
            name: t.competitors?.name
          };
        }
      }
    }

    const posts = (data || []).map(p => ({
      ...p,
      account_name: p.x_accounts?.display_name,
      account_handle: p.x_accounts?.handle,
      account_color: p.x_accounts?.color,
      x_accounts: undefined,
      target_tweet: p.target_tweet_id ? (targetTweetMap[p.target_tweet_id] || null) : null
    }));

    res.json(posts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/tweets/drafts/:id - Edit a draft post
router.put('/drafts/:id', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });

    const sb = getDb();
    const { data, error } = await sb.from('my_posts')
      .update({ text })
      .eq('id', req.params.id)
      .eq('status', 'draft')
      .select('id');
    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Draft not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/tweets/drafts/:id - Delete a draft post
router.delete('/drafts/:id', async (req, res) => {
  try {
    const sb = getDb();
    const { data, error } = await sb.from('my_posts')
      .delete()
      .eq('id', req.params.id)
      .eq('status', 'draft')
      .select('id');
    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Draft not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tweets/drafts/:id/post - Post a draft immediately
router.post('/drafts/:id/post', async (req, res) => {
  try {
    const sb = getDb();
    const { data: draft, error: fetchError } = await sb.from('my_posts')
      .select('*')
      .eq('id', req.params.id)
      .eq('status', 'draft')
      .single();
    if (fetchError) throw fetchError;
    if (!draft) return res.status(404).json({ error: 'Draft not found' });

    const postOptions = { accountId: draft.account_id };
    if (draft.post_type === 'reply' && draft.target_tweet_id) {
      postOptions.replyToId = draft.target_tweet_id;
    } else if (draft.post_type === 'quote' && draft.target_tweet_id) {
      postOptions.quoteTweetId = draft.target_tweet_id;
    }

    const xResult = await postTweet(draft.text, postOptions);

    const { error: updateError } = await sb.from('my_posts')
      .update({
        tweet_id: xResult.data.id,
        status: 'posted',
        posted_at: new Date().toISOString()
      })
      .eq('id', req.params.id);
    if (updateError) throw updateError;

    res.json({ tweet_id: xResult.data.id, status: 'posted' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/tweets/drafts/:id/schedule - Schedule a draft
router.post('/drafts/:id/schedule', async (req, res) => {
  try {
    const { scheduledAt } = req.body;
    if (!scheduledAt) return res.status(400).json({ error: 'scheduledAt is required' });

    const sb = getDb();
    const { data, error } = await sb.from('my_posts')
      .update({
        status: 'scheduled',
        scheduled_at: scheduledAt
      })
      .eq('id', req.params.id)
      .eq('status', 'draft')
      .select('id');
    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Draft not found' });
    }
    res.json({ success: true, status: 'scheduled', scheduled_at: scheduledAt });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
