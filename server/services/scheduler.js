const cron = require('node-cron');
const { getDb } = require('../db/database');
const { postTweet, getUserTweets } = require('./x-api');
const { calculateEngagementRate } = require('./analytics');
const { BatchManager } = require('./batch-manager');
const { checkAndRunAutoPosts } = require('./auto-poster');
const { refreshOwnPostMetrics, recordFollowerSnapshot } = require('./growth-analytics');
const { logError, logWarn, logInfo } = require('./app-logger');

function startScheduler() {
  // Check for scheduled posts every minute
  cron.schedule('* * * * *', async () => {
    try {
      await processScheduledPosts();
    } catch (err) {
      console.error('Scheduler error (processScheduledPosts):', err.message);
      logError('scheduler', '予約投稿処理でエラー', { error: err.message, stack: err.stack });
    }
  });

  // Fetch competitor tweets based on configured interval
  cron.schedule('0 3 * * *', async () => {
    try {
      await fetchCompetitorTweetsIfDue();
    } catch (err) {
      console.error('Scheduler error (fetchCompetitorTweets):', err.message);
      logError('scheduler', '競合ツイート取得でエラー', { error: err.message, stack: err.stack });
    }
  });

  // Poll batch API results every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      const batchManager = new BatchManager();
      await batchManager.pollBatchResults();
    } catch (err) {
      console.error('Batch polling error:', err.message);
      logError('batch', 'バッチポーリングでエラー', { error: err.message, stack: err.stack });
    }
  });

  // Check and run auto posts every minute
  cron.schedule('* * * * *', async () => {
    try {
      await checkAndRunAutoPosts();
    } catch (err) {
      console.error('AutoPoster scheduler error:', err.message);
      logError('auto_post', '自動投稿スケジューラでエラー', { error: err.message, stack: err.stack });
    }
  });

  // Refresh own post metrics every 6 hours
  cron.schedule('0 */6 * * *', async () => {
    await refreshAllAccountMetrics();
  });

  // Record follower snapshots daily at 9 AM
  cron.schedule('0 9 * * *', async () => {
    await recordAllFollowerSnapshots();
  });

  console.log('Scheduler started');
}

async function refreshAllAccountMetrics() {
  try {
    const sb = getDb();
    const { data: accounts } = await sb.from('x_accounts').select('id');
    if (!accounts) return;

    for (const account of accounts) {
      await refreshOwnPostMetrics(account.id);
    }
  } catch (err) {
    console.error('Error refreshing own post metrics:', err.message);
  }
}

async function recordAllFollowerSnapshots() {
  try {
    const sb = getDb();
    const { data: accounts } = await sb.from('x_accounts').select('id');
    if (!accounts) return;

    for (const account of accounts) {
      await recordFollowerSnapshot(account.id);
    }
  } catch (err) {
    console.error('Error recording follower snapshots:', err.message);
  }
}

async function processScheduledPosts() {
  const sb = getDb();
  const now = new Date().toISOString();

  const { data: posts, error } = await sb.from('my_posts')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now);

  if (error) {
    console.error('Scheduler: failed to query scheduled posts:', error.message || error);
    logError('scheduler', '予約投稿の取得に失敗', { error: error.message || String(error) });
    return;
  }

  if (!posts || posts.length === 0) return;

  console.log(`Scheduler: found ${posts.length} scheduled post(s) to process`);

  for (const post of posts) {
    try {
      const options = { accountId: post.account_id };
      if (post.post_type === 'reply' && post.target_tweet_id) {
        options.replyToId = post.target_tweet_id;
      }
      if (post.post_type === 'quote' && post.target_tweet_id) {
        options.quoteTweetId = post.target_tweet_id;
      }

      const result = await postTweet(post.text, options);

      const { error: updateError } = await sb.from('my_posts')
        .update({ status: 'posted', tweet_id: result.data.id, posted_at: new Date().toISOString() })
        .eq('id', post.id);

      if (updateError) {
        console.error(`Scheduler: posted tweet but failed to update DB for post ${post.id}:`, updateError.message);
      } else {
        console.log(`Scheduled post ${post.id} published: ${result.data.id}`);
      }
    } catch (err) {
      console.error(`Failed to publish scheduled post ${post.id}:`, err.message);
      logError('scheduler', `予約投稿 ${post.id} の公開に失敗`, { postId: post.id, error: err.message, stack: err.stack });
      try {
        await sb.from('my_posts')
          .update({ status: 'failed' })
          .eq('id', post.id);
      } catch (updateErr) {
        console.error(`Scheduler: also failed to mark post ${post.id} as failed:`, updateErr.message);
      }
    }
  }
}

async function fetchCompetitorTweetsIfDue() {
  const sb = getDb();

  const { data: intervalRow } = await sb.from('settings')
    .select('value')
    .eq('key', 'competitor_fetch_interval')
    .single();
  const interval = intervalRow ? intervalRow.value : 'weekly';

  const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  let shouldFetch = false;

  switch (interval) {
    case 'daily':
      shouldFetch = true;
      break;
    case 'weekly':
      shouldFetch = dayOfWeek === 1; // Monday
      break;
    case 'biweekly': {
      const weekNum = Math.ceil(new Date().getDate() / 7);
      shouldFetch = dayOfWeek === 1 && weekNum % 2 === 1;
      break;
    }
  }

  if (!shouldFetch) return;
  await fetchAllCompetitorTweets();
}

async function fetchAllCompetitorTweets() {
  const sb = getDb();
  const { data: competitors } = await sb.from('competitors').select('*');

  if (!competitors) return;

  for (const competitor of competitors) {
    try {
      // Skip if we already have recent tweets (fetched within 24h) to save API costs
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: recentTweets } = await sb.from('competitor_tweets')
        .select('id')
        .eq('competitor_id', competitor.id)
        .gte('fetched_at', oneDayAgo)
        .limit(1);
      if (recentTweets && recentTweets.length > 0) {
        console.log(`Skipping @${competitor.handle} - tweets fetched recently`);
        continue;
      }

      // Reduced from 100 to 30 to save costs ($0.15 vs $0.50 per call)
      const result = await getUserTweets(competitor.user_id, 30, competitor.account_id);
      if (!result.data) continue;

      const rows = result.data.map(tweet => {
        const metrics = tweet.public_metrics || {};
        const engRate = calculateEngagementRate({
          like_count: metrics.like_count || 0,
          retweet_count: metrics.retweet_count || 0,
          reply_count: metrics.reply_count || 0,
          quote_count: metrics.quote_count || 0,
          impression_count: metrics.impression_count || 0
        });

        const hasMedia = !!(tweet.attachments && tweet.attachments.media_keys);
        const hasLink = !!(tweet.entities && tweet.entities.urls && tweet.entities.urls.length > 0);
        const isThread = !!(tweet.entities && tweet.entities.mentions && tweet.text.startsWith('@'));

        return {
          competitor_id: competitor.id,
          tweet_id: tweet.id,
          text: tweet.text,
          created_at_x: tweet.created_at,
          like_count: metrics.like_count || 0,
          retweet_count: metrics.retweet_count || 0,
          reply_count: metrics.reply_count || 0,
          impression_count: metrics.impression_count || 0,
          quote_count: metrics.quote_count || 0,
          bookmark_count: metrics.bookmark_count || 0,
          engagement_rate: engRate,
          has_media: hasMedia,
          has_link: hasLink,
          is_thread: isThread
        };
      });

      // Upsert to avoid duplicates (tweet_id is unique)
      const { error } = await sb.from('competitor_tweets')
        .upsert(rows, { onConflict: 'tweet_id', ignoreDuplicates: true });

      if (error) {
        console.error(`Error inserting tweets for @${competitor.handle}:`, error.message);
        logError('competitor', `@${competitor.handle} のツイート保存に失敗`, { handle: competitor.handle, error: error.message });
      } else {
        console.log(`Fetched ${result.data.length} tweets for @${competitor.handle}`);
      }
    } catch (err) {
      console.error(`Failed to fetch tweets for @${competitor.handle}:`, err.message);
      logError('competitor', `@${competitor.handle} のツイート取得に失敗`, { handle: competitor.handle, error: err.message, stack: err.stack });
    }
  }
}

module.exports = { startScheduler, processScheduledPosts, fetchAllCompetitorTweets };
