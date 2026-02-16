const cron = require('node-cron');
const { getDb } = require('../db/database');
const { postTweet, getUserTweets } = require('./x-api');
const { calculateEngagementRate } = require('./analytics');
const { BatchManager } = require('./batch-manager');

function startScheduler() {
  // Check for scheduled posts every minute
  cron.schedule('* * * * *', async () => {
    await processScheduledPosts();
  });

  // Fetch competitor tweets based on configured interval
  cron.schedule('0 3 * * *', async () => {
    // Runs daily at 3 AM, but respects the interval setting
    await fetchCompetitorTweetsIfDue();
  });

  // Poll batch API results every 5 minutes
  cron.schedule('*/5 * * * *', async () => {
    try {
      const batchManager = new BatchManager();
      await batchManager.pollBatchResults();
    } catch (err) {
      console.error('Batch polling error:', err.message);
    }
  });

  console.log('Scheduler started');
}

async function processScheduledPosts() {
  const sb = getDb();
  const now = new Date().toISOString();

  const { data: posts, error } = await sb.from('my_posts')
    .select('*')
    .eq('status', 'scheduled')
    .lte('scheduled_at', now);

  if (error || !posts) return;

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

      await sb.from('my_posts')
        .update({ status: 'posted', tweet_id: result.data.id, posted_at: new Date().toISOString() })
        .eq('id', post.id);

      console.log(`Scheduled post ${post.id} published: ${result.data.id}`);
    } catch (err) {
      await sb.from('my_posts')
        .update({ status: 'failed' })
        .eq('id', post.id);

      console.error(`Failed to publish scheduled post ${post.id}:`, err.message);
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
      const result = await getUserTweets(competitor.user_id, 100, competitor.account_id);
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

      if (error) console.error(`Error inserting tweets for @${competitor.handle}:`, error.message);
      else console.log(`Fetched ${result.data.length} tweets for @${competitor.handle}`);
    } catch (err) {
      console.error(`Failed to fetch tweets for @${competitor.handle}:`, err.message);
    }
  }
}

module.exports = { startScheduler, processScheduledPosts, fetchAllCompetitorTweets };
