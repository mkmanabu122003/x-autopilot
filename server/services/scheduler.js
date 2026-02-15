const cron = require('node-cron');
const { getDb } = require('../db/database');
const { postTweet, getUserTweets } = require('./x-api');
const { calculateEngagementRate } = require('./analytics');

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

  console.log('Scheduler started');
}

async function processScheduledPosts() {
  const db = getDb();
  const now = new Date().toISOString();

  const posts = db.prepare(`
    SELECT * FROM my_posts
    WHERE status = 'scheduled'
    AND scheduled_at <= ?
  `).all(now);

  for (const post of posts) {
    try {
      const options = {};
      if (post.post_type === 'reply' && post.target_tweet_id) {
        options.replyToId = post.target_tweet_id;
      }
      if (post.post_type === 'quote' && post.target_tweet_id) {
        options.quoteTweetId = post.target_tweet_id;
      }

      const result = await postTweet(post.text, options);

      db.prepare(`
        UPDATE my_posts SET status = 'posted', tweet_id = ?, posted_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(result.data.id, post.id);

      console.log(`Scheduled post ${post.id} published: ${result.data.id}`);
    } catch (error) {
      db.prepare(`
        UPDATE my_posts SET status = 'failed'
        WHERE id = ?
      `).run(post.id);

      console.error(`Failed to publish scheduled post ${post.id}:`, error.message);
    }
  }
}

async function fetchCompetitorTweetsIfDue() {
  const db = getDb();

  const intervalRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('competitor_fetch_interval');
  const interval = intervalRow ? intervalRow.value : 'weekly';

  // Determine if we should fetch today
  const dayOfWeek = new Date().getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  let shouldFetch = false;

  switch (interval) {
    case 'daily':
      shouldFetch = true;
      break;
    case 'weekly':
      shouldFetch = dayOfWeek === 1; // Monday
      break;
    case 'biweekly':
      const weekNum = Math.ceil(new Date().getDate() / 7);
      shouldFetch = dayOfWeek === 1 && weekNum % 2 === 1;
      break;
  }

  if (!shouldFetch) return;

  await fetchAllCompetitorTweets();
}

async function fetchAllCompetitorTweets() {
  const db = getDb();
  const competitors = db.prepare('SELECT * FROM competitors').all();

  for (const competitor of competitors) {
    try {
      const result = await getUserTweets(competitor.user_id);

      if (!result.data) continue;

      const insertStmt = db.prepare(`
        INSERT OR IGNORE INTO competitor_tweets
        (competitor_id, tweet_id, text, created_at_x, like_count, retweet_count,
         reply_count, impression_count, quote_count, bookmark_count,
         engagement_rate, has_media, has_link, is_thread)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertAll = db.transaction((tweets) => {
        for (const tweet of tweets) {
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
          const isThread = !!(tweet.entities && tweet.entities.mentions &&
            tweet.text.startsWith('@'));

          insertStmt.run(
            competitor.id,
            tweet.id,
            tweet.text,
            tweet.created_at,
            metrics.like_count || 0,
            metrics.retweet_count || 0,
            metrics.reply_count || 0,
            metrics.impression_count || 0,
            metrics.quote_count || 0,
            metrics.bookmark_count || 0,
            engRate,
            hasMedia ? 1 : 0,
            hasLink ? 1 : 0,
            isThread ? 1 : 0
          );
        }
      });

      insertAll(result.data);
      console.log(`Fetched ${result.data.length} tweets for @${competitor.handle}`);
    } catch (error) {
      console.error(`Failed to fetch tweets for @${competitor.handle}:`, error.message);
    }
  }
}

module.exports = { startScheduler, processScheduledPosts, fetchAllCompetitorTweets };
