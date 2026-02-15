const crypto = require('crypto');
const { getDb } = require('../db/database');

const API_BASE = 'https://api.twitter.com';

function getOAuthHeader(method, url, params = {}) {
  const oauthParams = {
    oauth_consumer_key: process.env.X_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: process.env.X_ACCESS_TOKEN,
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

  const signingKey = `${encodeURIComponent(process.env.X_API_SECRET)}&${encodeURIComponent(process.env.X_ACCESS_TOKEN_SECRET)}`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  oauthParams.oauth_signature = signature;

  const authHeader = 'OAuth ' + Object.keys(oauthParams)
    .sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(oauthParams[k])}"`)
    .join(', ');

  return authHeader;
}

function logApiUsage(apiType, endpoint, costUsd) {
  const db = getDb();
  db.prepare(
    'INSERT INTO api_usage_log (api_type, endpoint, cost_usd) VALUES (?, ?, ?)'
  ).run(apiType, endpoint, costUsd);
}

async function postTweet(text, options = {}) {
  const url = `${API_BASE}/2/tweets`;
  const body = { text };

  if (options.replyToId) {
    body.reply = { in_reply_to_tweet_id: options.replyToId };
  }
  if (options.quoteTweetId) {
    body.quote_tweet_id = options.quoteTweetId;
  }

  const authHeader = getOAuthHeader('POST', url);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': authHeader
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`X API error ${response.status}: ${JSON.stringify(error)}`);
  }

  logApiUsage('x_write', 'POST /2/tweets', 0.01);
  return response.json();
}

async function getUserByHandle(handle) {
  const cleanHandle = handle.replace('@', '');
  const url = `${API_BASE}/2/users/by/username/${cleanHandle}`;
  const params = { 'user.fields': 'public_metrics,description,profile_image_url' };
  const queryString = new URLSearchParams(params).toString();
  const fullUrl = `${url}?${queryString}`;

  const response = await fetch(fullUrl, {
    headers: {
      'Authorization': `Bearer ${process.env.X_BEARER_TOKEN}`
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`X API error ${response.status}: ${JSON.stringify(error)}`);
  }

  logApiUsage('x_user', 'GET /2/users/by/username', 0.01);
  return response.json();
}

async function getUserTweets(userId, maxResults = 100) {
  const url = `${API_BASE}/2/users/${userId}/tweets`;
  const params = {
    'tweet.fields': 'public_metrics,created_at,entities,attachments',
    'max_results': String(Math.min(maxResults, 100))
  };
  const queryString = new URLSearchParams(params).toString();
  const fullUrl = `${url}?${queryString}`;

  const response = await fetch(fullUrl, {
    headers: {
      'Authorization': `Bearer ${process.env.X_BEARER_TOKEN}`
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(`X API error ${response.status}: ${JSON.stringify(error)}`);
  }

  const data = await response.json();
  const tweetCount = data.data ? data.data.length : 0;
  logApiUsage('x_read', 'GET /2/users/:id/tweets', tweetCount * 0.005);
  return data;
}

module.exports = {
  postTweet,
  getUserByHandle,
  getUserTweets,
  logApiUsage
};
