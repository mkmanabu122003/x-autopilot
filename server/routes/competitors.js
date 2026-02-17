const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { getUserByHandle, getUserTweets, searchRecentTweets } = require('../services/x-api');
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
    const suggestions = { profile: [], competitor: [], debug: '' };

    // 1. Get the user's own X account profile for AI-based suggestions
    const { data: account } = await sb.from('x_accounts')
      .select('handle, display_name, default_ai_provider, default_ai_model')
      .eq('id', accountId)
      .single();

    if (account) {
      // Build list of available providers (preferred first, with fallback)
      const providers = [];
      const savedModel = account.default_ai_model || '';

      // Check task-level preferred provider for competitor_analysis
      let preferredProvider = account.default_ai_provider || '';
      try {
        const { AIProvider } = require('../services/ai-provider');
        const baseProvider = new AIProvider();
        const taskSettings = await baseProvider.getTaskModelSettings('competitor_analysis', 'claude');
        if (taskSettings.preferredProvider) {
          preferredProvider = taskSettings.preferredProvider;
        }
      } catch (e) {
        // Fall through to account default
      }

      if (process.env.CLAUDE_API_KEY) {
        const model = savedModel.startsWith('claude') ? savedModel : 'claude-sonnet-4-20250514';
        providers.push({ name: 'claude', model });
      }
      if (process.env.GEMINI_API_KEY) {
        const model = savedModel.startsWith('gemini') ? savedModel : 'gemini-2.0-flash';
        providers.push({ name: 'gemini', model });
      }

      // Put preferred provider first
      if (preferredProvider && providers.length > 1) {
        providers.sort((a, b) => (a.name === preferredProvider ? -1 : b.name === preferredProvider ? 1 : 0));
      }

      if (providers.length === 0) {
        suggestions.debug = 'AIプロバイダーのAPIキーが設定されていません（CLAUDE_API_KEY または GEMINI_API_KEY）';
      } else {
        // --- Fetch user profile and tweets for AI context ---
        let profileText = '';
        let userId = null;

        // Try to get user_id from competitors table first (avoids getUserByHandle API call just for ID)
        const { data: existingComp } = await sb.from('competitors')
          .select('user_id, name')
          .eq('handle', account.handle.replace('@', ''))
          .limit(1)
          .single();

        if (existingComp) {
          userId = existingComp.user_id;
        }

        // Always try to get profile description from X API (needed for accurate suggestions)
        try {
          const userData = await getUserByHandle(account.handle, accountId);
          const profile = userData.data;
          profileText = profile?.description || '';
          if (!userId) userId = profile?.id || null;
        } catch (err) {
          // X API lookup failed, continue with available data
        }

        // Fetch user's posted tweets from database FIRST (free, no API cost)
        let dbTweetsText = '';
        try {
          const { data: myPosts } = await sb.from('my_posts')
            .select('text')
            .eq('account_id', accountId)
            .eq('status', 'posted')
            .order('posted_at', { ascending: false })
            .limit(15);
          if (myPosts && myPosts.length > 0) {
            dbTweetsText = myPosts.map(p => p.text).filter(Boolean).join('\n');
          }
        } catch (err) {
          // DB fetch failed, continue without
        }

        // Only call X API for tweets if we don't have enough DB data
        let recentTweetsText = '';
        if (!dbTweetsText && userId) {
          try {
            const tweetsData = await getUserTweets(userId, 10, accountId);
            if (tweetsData.data && tweetsData.data.length > 0) {
              const tweetTexts = tweetsData.data
                .map(t => t.text)
                .filter(t => t && !t.startsWith('RT @'))
                .slice(0, 10);
              if (tweetTexts.length > 0) {
                recentTweetsText = tweetTexts.join('\n');
              }
            }
          } catch (err) {
            // Tweet fetch failed, continue without tweets
          }
        }

        // Combine all tweet texts (DB data preferred)
        const allTweets = dbTweetsText || recentTweetsText
          ? [dbTweetsText, recentTweetsText].filter(Boolean).join('\n')
          : '';

        const accountName = account.display_name || account.handle;
        const tweetSection = allTweets
          ? `\n最近のツイート:\n${allTweets}\n`
          : '';
        const hasProfileOrTweets = !!(profileText || allTweets);
        const prompt = `あなたはX（Twitter）の競合分析の専門家です。以下のアカウント情報をもとに、競合アカウントを検索するためのキーワードをJSON配列で提案してください。

アカウント名: ${accountName}
ハンドル: @${account.handle}
${profileText ? `プロフィール: ${profileText}` : '（プロフィール情報なし）'}
${tweetSection || '（ツイートデータなし）'}
【ルール】
- プロフィールやツイート内容がある場合は、その内容から主要トピックや専門分野を特定し、それに関連するキーワードを5〜8個提案すること
- プロフィールやツイート内容がない場合（情報が不十分な場合）は、無関係なキーワードを推測で生成せず、空の配列 [] を返すこと
- 絶対に、提供された情報と無関係な一般的トピック（宅建、FX、投資、ダイエット等）を推測で含めないこと
- アカウント名やハンドル名だけでは、そのアカウントの分野を特定できないため、推測でキーワードを生成しないこと
- ハッシュタグは不要。各キーワードは1〜3語の短いフレーズにすること
- 説明文は不要。JSON配列のみ出力すること

出力形式（この形式以外は禁止）:
["キーワード1", "キーワード2", "キーワード3", "キーワード4", "キーワード5"]`;

        // Try each provider with fallback
        const errors = [];
        for (const provider of providers) {
          try {
            let response;
            if (provider.name === 'gemini') {
              const url = `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
              response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ parts: [{ text: prompt }] }],
                  generationConfig: { maxOutputTokens: 256, responseMimeType: 'application/json' }
                })
              });
            } else {
              response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': process.env.CLAUDE_API_KEY,
                  'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                  model: provider.model,
                  max_tokens: 256,
                  system: 'あなたはJSON配列のみを出力するアシスタントです。説明文や前置きは一切不要です。必ずJSON配列だけを返してください。',
                  messages: [{ role: 'user', content: prompt }]
                })
              });
            }

            if (response.ok) {
              const data = await response.json();
              const text = provider.name === 'gemini'
                ? data.candidates?.[0]?.content?.parts?.[0]?.text || ''
                : data.content?.[0]?.text || '';
              const match = text.match(/\[[\s\S]*?\]/);
              if (match) {
                suggestions.profile = JSON.parse(match[0]);
                break; // Success, stop trying
              } else {
                errors.push(`${provider.name}: パース失敗`);
              }
            } else {
              const errBody = await response.json().catch(() => ({}));
              errors.push(`${provider.name}(${response.status}): ${errBody?.error?.message || JSON.stringify(errBody).substring(0, 100)}`);
              // Continue to next provider (fallback)
            }
          } catch (err) {
            errors.push(`${provider.name}: ${err.message}`);
          }
        }

        if (suggestions.profile.length === 0) {
          if (errors.length > 0) {
            suggestions.debug = errors.join(' / ');
          } else if (!hasProfileOrTweets) {
            suggestions.debug = 'プロフィールやツイートのデータが取得できなかったため、キーワードを提案できませんでした。アカウントのプロフィール設定やツイート投稿後に再度お試しください。';
          }
        }
      }
    } else {
      suggestions.debug = 'アカウントが見つかりません';
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
          const cleaned = tweet.text
            .replace(/https?:\/\/\S+/g, '')
            .replace(/@\w+/g, '')
            .replace(/#\S+/g, '');
          const words = cleaned.match(/[\u3040-\u9FFFa-zA-Z]{2,}/g) || [];
          for (const w of words) {
            if (stopWords.has(w) || w.length < 2) continue;
            wordCounts[w] = (wordCounts[w] || 0) + 1;
          }
        }

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

    // Fetch existing competitors to avoid duplicates
    let existingQuery = sb.from('competitors').select('handle, user_id');
    if (accountId) {
      existingQuery = existingQuery.eq('account_id', accountId);
    }
    const { data: existingRows } = await existingQuery;
    const existingHandles = new Set((existingRows || []).map(r => r.handle.toLowerCase()));
    const existingUserIds = new Set((existingRows || []).map(r => r.user_id));

    const toInsert = users.slice(0, remaining)
      .map(u => ({
        account_id: accountId || null,
        handle: u.handle.replace('@', ''),
        name: u.name,
        user_id: u.user_id,
        followers_count: u.followers_count || 0
      }))
      .filter(u => !existingHandles.has(u.handle.toLowerCase()) && !existingUserIds.has(u.user_id));

    let data = [];
    if (toInsert.length > 0) {
      const result = await sb.from('competitors')
        .insert(toInsert)
        .select();

      if (result.error) throw result.error;
      data = result.data || [];
    }

    const skipped = users.length - toInsert.length;
    const skippedByLimit = Math.max(0, users.length - remaining);
    const skippedByDuplicate = skipped - skippedByLimit;
    res.json({
      added: data,
      skipped_limit: skippedByLimit,
      skipped_duplicate: skippedByDuplicate,
      message: skipped > 0
        ? `${data.length}件追加しました${skippedByLimit > 0 ? `（上限により${skippedByLimit}件スキップ）` : ''}${skippedByDuplicate > 0 ? `（重複${skippedByDuplicate}件スキップ）` : ''}`
        : `${data.length}件追加しました`
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
