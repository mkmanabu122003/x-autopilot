const crypto = require('crypto');
const { getDb } = require('../db/database');
const { decrypt } = require('../utils/crypto');

const API_BASE = 'https://api.twitter.com';

// --- In-memory cache for X API responses ---
const apiCache = new Map();
const CACHE_TTL = {
  user_by_handle: 24 * 60 * 60 * 1000, // 24 hours (profiles rarely change)
  user_tweets: 60 * 60 * 1000,          // 1 hour
  search_tweets: 30 * 60 * 1000,        // 30 minutes
};

function getCacheKey(type, ...args) {
  return `${type}:${args.join(':')}`;
}

function getFromCache(key) {
  const entry = apiCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttl) {
    apiCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key, data, ttl) {
  apiCache.set(key, { data, timestamp: Date.now(), ttl });
  // Prevent unbounded growth
  if (apiCache.size > 500) {
    const oldest = apiCache.keys().next().value;
    apiCache.delete(oldest);
  }
}

// --- Budget guard: check X API budget before calling ---
async function checkXApiBudget() {
  try {
    const sb = getDb();
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const { data: usageRows } = await sb.from('api_usage_log')
      .select('cost_usd')
      .gte('created_at', startOfMonth)
      .like('api_type', 'x_%');
    const totalCost = (usageRows || []).reduce((sum, r) => sum + (r.cost_usd || 0), 0);

    const { data: budgetRow } = await sb.from('settings')
      .select('value').eq('key', 'budget_x_api_usd').single();
    const budget = budgetRow ? parseFloat(budgetRow.value) : 10;

    return { totalCost, budget, overBudget: totalCost >= budget };
  } catch {
    return { totalCost: 0, budget: 10, overBudget: false };
  }
}

async function getAccountCredentials(accountId) {
  const sb = getDb();
  const { data, error } = await sb.from('x_accounts').select('*').eq('id', accountId).single();
  if (error || !data) throw new Error(`Account not found: ${accountId}`);

  return {
    ...data,
    api_key: decrypt(data.api_key),
    api_secret: decrypt(data.api_secret),
    access_token: decrypt(data.access_token),
    access_token_secret: decrypt(data.access_token_secret),
    bearer_token: decrypt(data.bearer_token),
  };
}

function getOAuthHeader(method, url, credentials, params = {}) {
  const oauthParams = {
    oauth_consumer_key: credentials.api_key,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: credentials.access_token,
    oauth_version: '1.0'
  };

  const allParams = { ...oauthParams, ...params };
  const sortedKeys = Object.keys(allParams).sort();
  const paramString = sortedKeys
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(allParams[k])}`)
    .join('&');

  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(paramString)
  ].join('&');

  const signingKey = `${encodeURIComponent(credentials.api_secret)}&${encodeURIComponent(credentials.access_token_secret)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  oauthParams.oauth_signature = signature;

  return 'OAuth ' + Object.keys(oauthParams)
    .sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(', ');
}

async function logApiUsage(apiType, endpoint, costUsd, accountId) {
  const sb = getDb();
  await sb.from('api_usage_log').insert({
    account_id: accountId || null, api_type: apiType, endpoint, cost_usd: costUsd
  });
}

async function postTweet(text, options = {}) {
  const { accountId, replyToId, quoteTweetId } = options;
  if (!accountId) throw new Error('accountId is required for posting');

  const credentials = await getAccountCredentials(accountId);
  const url = `${API_BASE}/2/tweets`;
  const body = { text };
  if (replyToId) body.reply = { in_reply_to_tweet_id: replyToId };
  if (quoteTweetId) body.quote_tweet_id = quoteTweetId;

  const authHeader = getOAuthHeader('POST', url, credentials);

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': authHeader },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`X API error ${response.status}: ${JSON.stringify(error)}`);
  }

  await logApiUsage('x_write', 'POST /2/tweets', 0.01, accountId);
  return response.json();
}

async function getUserByHandle(handle, accountId, options = {}) {
  if (!accountId) throw new Error('accountId is required');
  const cleanHandle = handle.replace('@', '');

  // Check cache first
  const cacheKey = getCacheKey('user_by_handle', cleanHandle);
  if (!options.skipCache) {
    const cached = getFromCache(cacheKey);
    if (cached) {
      console.log(`[X API Cache HIT] getUserByHandle @${cleanHandle}`);
      return cached;
    }
  }

  // Budget guard (skip for non-optional calls)
  if (!options.skipBudgetCheck) {
    const budget = await checkXApiBudget();
    if (budget.overBudget) {
      throw new Error(`X API予算超過 ($${budget.totalCost.toFixed(2)}/$${budget.budget.toFixed(2)})。設定で予算を調整してください。`);
    }
  }

  const credentials = await getAccountCredentials(accountId);
  if (!credentials.bearer_token) throw new Error('Bearer token is not set for this account');

  const fullUrl = `${API_BASE}/2/users/by/username/${cleanHandle}?${new URLSearchParams({ 'user.fields': 'public_metrics,description,profile_image_url' })}`;

  const response = await fetch(fullUrl, {
    headers: { 'Authorization': `Bearer ${credentials.bearer_token}` }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`X API error ${response.status}: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  setCache(cacheKey, data, CACHE_TTL.user_by_handle);
  await logApiUsage('x_user', 'GET /2/users/by/username', 0.01, accountId);
  return data;
}

async function getUserTweets(userId, maxResults = 100, accountId, options = {}) {
  if (!accountId) throw new Error('accountId is required');

  // Check cache first
  const cacheKey = getCacheKey('user_tweets', userId, maxResults);
  if (!options.skipCache) {
    const cached = getFromCache(cacheKey);
    if (cached) {
      console.log(`[X API Cache HIT] getUserTweets userId=${userId}`);
      return cached;
    }
  }

  // Budget guard
  if (!options.skipBudgetCheck) {
    const budget = await checkXApiBudget();
    if (budget.overBudget) {
      throw new Error(`X API予算超過 ($${budget.totalCost.toFixed(2)}/$${budget.budget.toFixed(2)})。設定で予算を調整してください。`);
    }
  }

  const credentials = await getAccountCredentials(accountId);
  if (!credentials.bearer_token) throw new Error('Bearer token is not set for this account');

  const fullUrl = `${API_BASE}/2/users/${userId}/tweets?${new URLSearchParams({
    'tweet.fields': 'public_metrics,created_at,entities,attachments',
    'max_results': String(Math.min(maxResults, 100))
  })}`;

  const response = await fetch(fullUrl, {
    headers: { 'Authorization': `Bearer ${credentials.bearer_token}` }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`X API error ${response.status}: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  const tweetCount = data.data ? data.data.length : 0;
  setCache(cacheKey, data, CACHE_TTL.user_tweets);
  await logApiUsage('x_read', 'GET /2/users/:id/tweets', tweetCount * 0.005, accountId);
  return data;
}

async function verifyCredentials(accountId) {
  const credentials = await getAccountCredentials(accountId);
  const result = { oauth: false, bearer: false, user: null, errors: [] };

  // Verify OAuth credentials via GET /2/users/me
  try {
    const url = `${API_BASE}/2/users/me`;
    const params = { 'user.fields': 'username,name,profile_image_url' };
    const fullUrl = `${url}?${new URLSearchParams(params)}`;
    const authHeader = getOAuthHeader('GET', url, credentials, params);

    const response = await fetch(fullUrl, {
      headers: { 'Authorization': authHeader }
    });

    if (response.ok) {
      const data = await response.json();
      result.oauth = true;
      result.user = data.data || null;
    } else {
      const error = await response.json().catch(() => ({}));
      result.errors.push(`OAuth認証エラー (${response.status}): ${JSON.stringify(error)}`);
    }
  } catch (err) {
    result.errors.push(`OAuth接続エラー: ${err.message}`);
  }

  // Verify Bearer token if set
  if (credentials.bearer_token) {
    try {
      const handle = result.user?.username || credentials.handle;
      if (handle) {
        const cleanHandle = handle.replace('@', '');
        const fullUrl = `${API_BASE}/2/users/by/username/${cleanHandle}?${new URLSearchParams({ 'user.fields': 'username' })}`;
        const response = await fetch(fullUrl, {
          headers: { 'Authorization': `Bearer ${credentials.bearer_token}` }
        });

        if (response.ok) {
          result.bearer = true;
        } else {
          const error = await response.json().catch(() => ({}));
          result.errors.push(`Bearerトークンエラー (${response.status}): ${JSON.stringify(error)}`);
        }
      }
    } catch (err) {
      result.errors.push(`Bearer接続エラー: ${err.message}`);
    }
  }

  return result;
}

async function searchRecentTweets(query, accountId, maxResults = 100, options = {}) {
  if (!accountId) throw new Error('accountId is required');

  // Check cache first
  const cacheKey = getCacheKey('search_tweets', query, maxResults);
  if (!options.skipCache) {
    const cached = getFromCache(cacheKey);
    if (cached) {
      console.log(`[X API Cache HIT] searchRecentTweets query="${query}"`);
      return cached;
    }
  }

  // Budget guard
  if (!options.skipBudgetCheck) {
    const budget = await checkXApiBudget();
    if (budget.overBudget) {
      throw new Error(`X API予算超過 ($${budget.totalCost.toFixed(2)}/$${budget.budget.toFixed(2)})。設定で予算を調整してください。`);
    }
  }

  const credentials = await getAccountCredentials(accountId);
  if (!credentials.bearer_token) throw new Error('Bearer token is not set for this account');

  const params = new URLSearchParams({
    'query': query,
    'tweet.fields': 'public_metrics,created_at,author_id',
    'expansions': 'author_id',
    'user.fields': 'public_metrics,description,profile_image_url',
    'max_results': String(Math.min(Math.max(maxResults, 10), 100))
  });
  const fullUrl = `${API_BASE}/2/tweets/search/recent?${params}`;

  const response = await fetch(fullUrl, {
    headers: { 'Authorization': `Bearer ${credentials.bearer_token}` }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`X API error ${response.status}: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  setCache(cacheKey, data, CACHE_TTL.search_tweets);
  await logApiUsage('x_search', 'GET /2/tweets/search/recent', 0.01, accountId);
  return data;
}

async function getTweetMetrics(tweetIds, accountId) {
  if (!accountId) throw new Error('accountId is required');
  if (!tweetIds || tweetIds.length === 0) return [];

  const credentials = await getAccountCredentials(accountId);
  if (!credentials.bearer_token) throw new Error('Bearer token is not set for this account');

  // X API allows up to 100 tweet IDs per request
  const chunks = [];
  for (let i = 0; i < tweetIds.length; i += 100) {
    chunks.push(tweetIds.slice(i, i + 100));
  }

  const allTweets = [];
  for (const chunk of chunks) {
    const params = new URLSearchParams({
      'ids': chunk.join(','),
      'tweet.fields': 'public_metrics,created_at'
    });
    const fullUrl = `${API_BASE}/2/tweets?${params}`;

    const response = await fetch(fullUrl, {
      headers: { 'Authorization': `Bearer ${credentials.bearer_token}` }
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.error(`getTweetMetrics error: ${response.status}`, error);
      continue;
    }

    const data = await response.json();
    if (data.data) allTweets.push(...data.data);
    await logApiUsage('x_read', 'GET /2/tweets', chunk.length * 0.001, accountId);
  }

  return allTweets;
}

async function getOwnProfile(accountId) {
  if (!accountId) throw new Error('accountId is required');

  const credentials = await getAccountCredentials(accountId);
  const url = `${API_BASE}/2/users/me`;
  const params = { 'user.fields': 'public_metrics,username,name,profile_image_url' };
  const fullUrl = `${url}?${new URLSearchParams(params)}`;
  const authHeader = getOAuthHeader('GET', url, credentials, params);

  const response = await fetch(fullUrl, {
    headers: { 'Authorization': authHeader }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`X API error ${response.status}: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  await logApiUsage('x_user', 'GET /2/users/me', 0.005, accountId);
  return data.data;
}

/**
 * Fetch tweet IDs that the authenticated user has replied to or quoted on X.
 * Used to filter out competitor tweets the user has already manually engaged with.
 * Returns an array of tweet IDs. Fails gracefully (returns []) on any error.
 */
async function getMyRepliedTweetIds(accountId) {
  if (!accountId) return [];

  // Check cache first
  const cacheKey = getCacheKey('my_replied_ids', accountId);
  const cached = getFromCache(cacheKey);
  if (cached) {
    console.log(`[X API Cache HIT] getMyRepliedTweetIds accountId=${accountId}`);
    return cached;
  }

  try {
    // Budget guard - fail gracefully if over budget
    const budget = await checkXApiBudget();
    if (budget.overBudget) {
      console.log('getMyRepliedTweetIds: X API budget exceeded, skipping');
      return [];
    }

    const profile = await getOwnProfile(accountId);
    const userId = profile.id;

    const credentials = await getAccountCredentials(accountId);
    if (!credentials.bearer_token) return [];

    const params = new URLSearchParams({
      'tweet.fields': 'referenced_tweets',
      'max_results': '100',
      'exclude': 'retweets'
    });
    const fullUrl = `${API_BASE}/2/users/${userId}/tweets?${params}`;

    const response = await fetch(fullUrl, {
      headers: { 'Authorization': `Bearer ${credentials.bearer_token}` }
    });

    if (!response.ok) {
      console.error(`getMyRepliedTweetIds: API error ${response.status}`);
      return [];
    }

    const data = await response.json();
    const tweetCount = data.data ? data.data.length : 0;
    await logApiUsage('x_read', 'GET /2/users/:id/tweets', tweetCount * 0.005, accountId);

    const repliedIds = [];
    for (const tweet of (data.data || [])) {
      if (tweet.referenced_tweets) {
        for (const ref of tweet.referenced_tweets) {
          if (ref.type === 'replied_to' || ref.type === 'quoted') {
            repliedIds.push(ref.id);
          }
        }
      }
    }

    // Cache for 1 hour (same as user_tweets)
    setCache(cacheKey, repliedIds, CACHE_TTL.user_tweets);
    return repliedIds;
  } catch (err) {
    console.error('getMyRepliedTweetIds: error:', err.message);
    return [];
  }
}

module.exports = { postTweet, getUserByHandle, getUserTweets, logApiUsage, getAccountCredentials, verifyCredentials, searchRecentTweets, checkXApiBudget, apiCache, getTweetMetrics, getOwnProfile, getMyRepliedTweetIds };
