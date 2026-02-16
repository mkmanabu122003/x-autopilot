const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { getUserByHandle, searchRecentTweets } = require('../services/x-api');
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

// POST /api/competitors/search - Auto-discover competitor accounts by keyword
router.post('/search', async (req, res) => {
  try {
    const {
      keyword, minFollowers, maxFollowers, language, accountId,
      minLikes, minRetweets, hasMedia, hasLinks, verified, excludeHandles
    } = req.body;
    if (!keyword) return res.status(400).json({ error: 'keyword is required' });
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });

    // Build search query with advanced operators
    let query = keyword;
    if (language) query += ` lang:${language}`;
    if (minLikes) query += ` min_faves:${parseInt(minLikes)}`;
    if (minRetweets) query += ` min_retweets:${parseInt(minRetweets)}`;
    if (hasMedia) query += ' has:media';
    if (hasLinks) query += ' has:links';
    // Exclude retweets and replies to get original content authors
    query += ' -is:retweet -is:reply';
    // Exclude specific handles
    if (excludeHandles && Array.isArray(excludeHandles)) {
      for (const h of excludeHandles) {
        query += ` -from:${h.replace('@', '')}`;
      }
    }

    const result = await searchRecentTweets(query, accountId, 100);

    if (!result.data || !result.includes?.users) {
      return res.json([]);
    }

    // Get existing competitor handles to exclude
    const sb = getDb();
    let existingQuery = sb.from('competitors').select('handle');
    if (accountId) {
      existingQuery = existingQuery.eq('account_id', accountId);
    }
    const { data: existingRows } = await existingQuery;
    const existingHandles = new Set((existingRows || []).map(r => r.handle.toLowerCase()));

    // Deduplicate users and calculate tweet counts from search results
    const userTweetCounts = {};
    for (const tweet of result.data) {
      const authorId = tweet.author_id;
      userTweetCounts[authorId] = (userTweetCounts[authorId] || 0) + 1;
    }

    // Build candidate list
    const candidates = result.includes.users
      .filter(user => {
        if (existingHandles.has(user.username.toLowerCase())) return false;
        const followers = user.public_metrics?.followers_count || 0;
        if (minFollowers && followers < minFollowers) return false;
        if (maxFollowers && followers > maxFollowers) return false;
        if (verified && !user.verified) return false;
        return true;
      })
      .map(user => ({
        user_id: user.id,
        handle: user.username,
        name: user.name,
        description: user.description || '',
        profile_image_url: user.profile_image_url || '',
        followers_count: user.public_metrics?.followers_count || 0,
        following_count: user.public_metrics?.following_count || 0,
        tweet_count: user.public_metrics?.tweet_count || 0,
        matched_tweets: userTweetCounts[user.id] || 0
      }))
      .sort((a, b) => b.followers_count - a.followers_count);

    res.json(candidates);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/competitors/bulk - Add multiple competitors at once
router.post('/bulk', async (req, res) => {
  try {
    const { users, accountId } = req.body;
    if (!users || !Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ error: 'users array is required' });
    }

    const sb = getDb();

    // Check max accounts limit
    const { data: maxRow } = await sb.from('settings').select('value').eq('key', 'competitor_max_accounts').single();
    const maxAccounts = maxRow ? parseInt(maxRow.value) : 10;

    let countQuery = sb.from('competitors').select('*', { count: 'exact', head: true });
    if (accountId) {
      countQuery = countQuery.eq('account_id', accountId);
    }
    const { count: currentCount } = await countQuery;

    const remaining = maxAccounts - currentCount;
    if (remaining <= 0) {
      return res.status(400).json({
        error: `登録上限に達しています (${maxAccounts}件)。設定で上限を変更してください。`
      });
    }

    const toInsert = users.slice(0, remaining).map(u => ({
      account_id: accountId || null,
      handle: u.handle.replace('@', ''),
      name: u.name,
      user_id: u.user_id,
      followers_count: u.followers_count || 0
    }));

    const { data, error } = await sb.from('competitors')
      .upsert(toInsert, { onConflict: 'account_id,handle', ignoreDuplicates: true })
      .select();

    if (error) throw error;

    const skipped = users.length - toInsert.length;
    res.json({
      added: data || [],
      skipped_limit: skipped,
      message: skipped > 0
        ? `${toInsert.length}件追加しました（上限により${skipped}件スキップ）`
        : `${(data || []).length}件追加しました`
    });
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
