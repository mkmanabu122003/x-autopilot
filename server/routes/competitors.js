const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { getUserByHandle } = require('../services/x-api');
const { calculateEngagementRate } = require('../services/analytics');
const { fetchAllCompetitorTweets } = require('../services/scheduler');

// GET /api/competitors - List all competitors (optionally filtered by account)
router.get('/', async (req, res) => {
  try {
    const sb = getDb();
    const accountId = req.query.accountId;

    let query = sb.from('competitors')
      .select('*, competitor_tweets(count)')
      .order('created_at', { ascending: false });

    if (accountId) {
      query = query.eq('account_id', accountId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const competitors = (data || []).map(c => ({
      ...c,
      tweet_count: c.competitor_tweets?.[0]?.count || 0,
      competitor_tweets: undefined
    }));

    res.json(competitors);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/competitors - Add a competitor
router.post('/', async (req, res) => {
  try {
    const { handle, accountId } = req.body;
    if (!handle) return res.status(400).json({ error: 'handle is required' });

    const sb = getDb();

    // Check max accounts limit
    const { data: maxRow } = await sb.from('settings').select('value').eq('key', 'competitor_max_accounts').single();
    const maxAccounts = maxRow ? parseInt(maxRow.value) : 10;

    let countQuery = sb.from('competitors').select('*', { count: 'exact', head: true });
    if (accountId) {
      countQuery = countQuery.eq('account_id', accountId);
    }
    const { count: currentCount } = await countQuery;

    if (currentCount >= maxAccounts) {
      return res.status(400).json({
        error: `Maximum competitor accounts reached (${maxAccounts}). Increase the limit in settings.`
      });
    }

    // Look up user on X API
    const userData = await getUserByHandle(handle, accountId);
    if (!userData.data) return res.status(404).json({ error: 'User not found on X' });

    const user = userData.data;
    const { data, error } = await sb.from('competitors').insert({
      account_id: accountId || null,
      handle: handle.replace('@', ''),
      name: user.name,
      user_id: user.id,
      followers_count: user.public_metrics ? user.public_metrics.followers_count : 0
    }).select().single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'Competitor already exists' });
      }
      throw error;
    }

    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/competitors/:id - Remove a competitor
router.delete('/:id', async (req, res) => {
  try {
    const sb = getDb();
    const { data, error } = await sb.from('competitors')
      .delete()
      .eq('id', req.params.id)
      .select('id');
    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Competitor not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/competitors/:id/tweets - Get competitor's tweets
router.get('/:id/tweets', async (req, res) => {
  try {
    const sb = getDb();
    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;

    const { data, error } = await sb.from('competitor_tweets')
      .select('*')
      .eq('competitor_id', req.params.id)
      .order('engagement_rate', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    res.json(data || []);
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
