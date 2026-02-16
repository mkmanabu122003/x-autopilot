const crypto = require('crypto');
const { getDb } = require('../db/database');
const { decrypt } = require('../utils/crypto');

const API_BASE = 'https://api.twitter.com';

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

async function getUserByHandle(handle, accountId) {
  if (!accountId) throw new Error('accountId is required');
  const credentials = await getAccountCredentials(accountId);
  if (!credentials.bearer_token) throw new Error('Bearer token is not set for this account');

  const cleanHandle = handle.replace('@', '');
  const fullUrl = `${API_BASE}/2/users/by/username/${cleanHandle}?${new URLSearchParams({ 'user.fields': 'public_metrics,description,profile_image_url' })}`;

  const response = await fetch(fullUrl, {
    headers: { 'Authorization': `Bearer ${credentials.bearer_token}` }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`X API error ${response.status}: ${JSON.stringify(error)}`);
  }

  await logApiUsage('x_user', 'GET /2/users/by/username', 0.01, accountId);
  return response.json();
}

async function getUserTweets(userId, maxResults = 100, accountId) {
  if (!accountId) throw new Error('accountId is required');
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

async function searchRecentTweets(query, accountId, maxResults = 100) {
  if (!accountId) throw new Error('accountId is required');
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
  await logApiUsage('x_search', 'GET /2/tweets/search/recent', 0.01, accountId);
  return data;
}

module.exports = { postTweet, getUserByHandle, getUserTweets, logApiUsage, getAccountCredentials, verifyCredentials, searchRecentTweets };
