const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { getUserByHandle, searchRecentTweets } = require('../services/x-api');
const { calculateEngagementRate } = require('../services/analytics');
const { fetchAllCompetitorTweets } = require('../services/scheduler');
const { getAIProvider } = require('../services/ai-provider');

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

// POST /api/competitors/suggest-keywords - AI-based keyword suggestions
router.post('/suggest-keywords', async (req, res) => {
  try {
    const { accountId } = req.body;
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });

    const sb = getDb();
    const suggestions = { profile: [], competitor: [] };

    // 1. Get the user's own X account profile for AI-based suggestions
    const { data: account } = await sb.from('x_accounts')
      .select('handle, display_name, default_ai_provider, default_ai_model')
      .eq('id', accountId)
      .single();

    if (account) {
      try {
        const userData = await getUserByHandle(account.handle, accountId);
        const profile = userData.data;
        if (profile && profile.description) {
          const providerName = account.default_ai_provider || 'claude';
          const aiProvider = getAIProvider(providerName);

          const prompt = `以下のXアカウントのプロフィールを分析し、このアカウントの競合を見つけるための検索キーワードを提案してください。

アカウント名: ${profile.name || account.display_name}
ハンドル: @${account.handle}
プロフィール: ${profile.description}

以下の形式でキーワードを5〜8個、JSON配列で出力してください。ハッシュタグは不要です。各キーワードは1〜3語の短いフレーズにしてください。
例: ["AIマーケティング", "SNS運用", "コンテンツ戦略"]

JSON配列のみ出力してください。`;

          const response = await fetch(
            providerName === 'gemini'
              ? `https://generativelanguage.googleapis.com/v1beta/models/${account.default_ai_model || 'gemini-2.0-flash'}:generateContent?key=${process.env.GEMINI_API_KEY}`
              : 'https://api.anthropic.com/v1/messages',
            providerName === 'gemini'
              ? {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 256 } })
                }
              : {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.CLAUDE_API_KEY, 'anthropic-version': '2023-06-01' },
                  body: JSON.stringify({
                    model: account.default_ai_model || 'claude-sonnet-4-20250514',
                    max_tokens: 256,
                    messages: [{ role: 'user', content: prompt }]
                  })
                }
          );

          if (response.ok) {
            const data = await response.json();
            const text = providerName === 'gemini'
              ? data.candidates?.[0]?.content?.parts?.[0]?.text || ''
              : data.content?.[0]?.text || '';
            const match = text.match(/\[[\s\S]*?\]/);
            if (match) {
              suggestions.profile = JSON.parse(match[0]);
            }
          }
        }
      } catch (err) {
        // Profile-based suggestions failed, continue with competitor-based
      }
    }

    // 2. Extract keywords from existing competitor tweets
    const { data: comps } = await sb.from('competitors').select('id').eq('account_id', accountId);
    const compIds = comps ? comps.map(c => c.id) : [];

    if (compIds.length > 0) {
      const { data: tweets } = await sb.from('competitor_tweets')
        .select('text')
        .in('competitor_id', compIds)
        .order('engagement_rate', { ascending: false })
        .limit(50);

      if (tweets && tweets.length > 0) {
        // Simple keyword extraction: split texts, count word frequency
        const wordCounts = {};
        const stopWords = new Set([
          'の', 'に', 'は', 'を', 'た', 'が', 'で', 'て', 'と', 'し', 'れ', 'さ',
          'ある', 'いる', 'する', 'から', 'こと', 'この', 'それ', 'ない', 'なる',
          'よう', 'ので', 'もの', 'です', 'ます', 'した', 'その', 'という', 'ている',
          'the', 'a', 'an', 'is', 'are', 'was', 'and', 'or', 'but', 'in', 'on', 'at',
          'to', 'for', 'of', 'with', 'by', 'from', 'it', 'this', 'that', 'RT', 'https', 'co', 't'
        ]);

        for (const tweet of tweets) {
          if (!tweet.text) continue;
          // Remove URLs, mentions, hashtags
          const cleaned = tweet.text
            .replace(/https?:\/\/\S+/g, '')
            .replace(/@\w+/g, '')
            .replace(/#\S+/g, '');

          // Extract meaningful phrases (2-4 char sequences that appear frequently in Japanese)
          const words = cleaned.match(/[\u3040-\u9FFFa-zA-Z]{2,}/g) || [];
          for (const w of words) {
            if (stopWords.has(w) || w.length < 2) continue;
            wordCounts[w] = (wordCounts[w] || 0) + 1;
          }
        }

        // Get top frequent words (appearing in 3+ tweets)
        suggestions.competitor = Object.entries(wordCounts)
          .filter(([, count]) => count >= 2)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([word, count]) => ({ word, count }));
      }
    }

    res.json(suggestions);
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

    // Build search query (only Basic-tier operators)
    let query = keyword;
    if (language) query += ` lang:${language}`;
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

    // Filter tweets by engagement thresholds (post-fetch, since min_faves/min_retweets require Pro tier)
    const filteredTweets = result.data.filter(tweet => {
      const metrics = tweet.public_metrics || {};
      if (minLikes && (metrics.like_count || 0) < parseInt(minLikes)) return false;
      if (minRetweets && (metrics.retweet_count || 0) < parseInt(minRetweets)) return false;
      return true;
    });

    // Deduplicate users and calculate tweet counts from filtered results
    const userTweetCounts = {};
    for (const tweet of filteredTweets) {
      const authorId = tweet.author_id;
      userTweetCounts[authorId] = (userTweetCounts[authorId] || 0) + 1;
    }

    // Build candidate list (only include users who have tweets passing engagement filters)
    const candidates = result.includes.users
      .filter(user => {
        if (!userTweetCounts[user.id]) return false;
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
