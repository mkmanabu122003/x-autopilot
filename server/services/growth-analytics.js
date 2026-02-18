const { getDb } = require('../db/database');
const { getTweetMetrics, getOwnProfile, checkXApiBudget } = require('./x-api');
const { calculateEngagementRate } = require('./analytics');

/**
 * Refresh engagement metrics for own posted tweets
 */
async function refreshOwnPostMetrics(accountId) {
  const sb = getDb();

  // Get posted tweets that have tweet_ids (successfully posted)
  let query = sb.from('my_posts')
    .select('id, tweet_id')
    .eq('status', 'posted')
    .not('tweet_id', 'is', null);
  if (accountId) query = query.eq('account_id', accountId);
  const { data: posts } = await query;

  if (!posts || posts.length === 0) return { updated: 0 };

  // Determine which account to use for API calls
  const effectiveAccountId = accountId || posts[0].account_id;
  if (!effectiveAccountId) return { updated: 0 };

  // Check budget before API call
  const budget = await checkXApiBudget();
  if (budget.overBudget) {
    console.log('Skipping post metrics refresh - X API budget exceeded');
    return { updated: 0, reason: 'budget_exceeded' };
  }

  const tweetIds = posts.map(p => p.tweet_id).filter(Boolean);
  if (tweetIds.length === 0) return { updated: 0 };

  try {
    const metrics = await getTweetMetrics(tweetIds, effectiveAccountId);

    let updated = 0;
    for (const tweet of metrics) {
      const pm = tweet.public_metrics || {};
      const engRate = calculateEngagementRate({
        like_count: pm.like_count || 0,
        retweet_count: pm.retweet_count || 0,
        reply_count: pm.reply_count || 0,
        quote_count: pm.quote_count || 0,
        impression_count: pm.impression_count || 0
      });

      const post = posts.find(p => p.tweet_id === tweet.id);
      if (!post) continue;

      const { error } = await sb.from('my_posts')
        .update({
          like_count: pm.like_count || 0,
          retweet_count: pm.retweet_count || 0,
          reply_count: pm.reply_count || 0,
          impression_count: pm.impression_count || 0,
          quote_count: pm.quote_count || 0,
          bookmark_count: pm.bookmark_count || 0,
          engagement_rate: engRate,
          metrics_updated_at: new Date().toISOString()
        })
        .eq('id', post.id);

      if (!error) updated++;
    }

    console.log(`Refreshed metrics for ${updated}/${posts.length} own posts`);
    return { updated };
  } catch (err) {
    console.error('Error refreshing own post metrics:', err.message);
    return { updated: 0, error: err.message };
  }
}

/**
 * Record a follower count snapshot for an account
 */
async function recordFollowerSnapshot(accountId) {
  if (!accountId) return null;

  const budget = await checkXApiBudget();
  if (budget.overBudget) {
    console.log('Skipping follower snapshot - X API budget exceeded');
    return null;
  }

  try {
    const profile = await getOwnProfile(accountId);
    if (!profile || !profile.public_metrics) return null;

    const sb = getDb();
    const { data, error } = await sb.from('follower_snapshots').insert({
      account_id: accountId,
      follower_count: profile.public_metrics.followers_count || 0,
      following_count: profile.public_metrics.following_count || 0,
      tweet_count: profile.public_metrics.tweet_count || 0,
      listed_count: profile.public_metrics.listed_count || 0,
      recorded_at: new Date().toISOString()
    }).select().single();

    if (error) {
      console.error('Error recording follower snapshot:', error.message);
      return null;
    }

    console.log(`Recorded follower snapshot: ${data.follower_count} followers`);
    return data;
  } catch (err) {
    console.error('Error recording follower snapshot:', err.message);
    return null;
  }
}

/**
 * Get follower growth data over time
 */
async function getFollowerGrowth(accountId, days = 90) {
  const sb = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  let query = sb.from('follower_snapshots')
    .select('follower_count, following_count, tweet_count, listed_count, recorded_at')
    .gte('recorded_at', cutoff.toISOString())
    .order('recorded_at', { ascending: true });
  if (accountId) query = query.eq('account_id', accountId);

  const { data } = await query;
  return data || [];
}

/**
 * Get growth dashboard summary (own performance KPIs)
 */
async function getGrowthDashboard(accountId) {
  const sb = getDb();
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
  const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();

  // Own posts this month with metrics
  let ownPostsQuery = sb.from('my_posts')
    .select('*')
    .eq('status', 'posted')
    .gte('posted_at', startOfMonth);
  if (accountId) ownPostsQuery = ownPostsQuery.eq('account_id', accountId);
  const { data: ownPosts } = await ownPostsQuery;
  const posts = ownPosts || [];

  // Own posts last month for comparison
  let lastMonthQuery = sb.from('my_posts')
    .select('like_count, retweet_count, reply_count, impression_count, engagement_rate')
    .eq('status', 'posted')
    .gte('posted_at', startOfLastMonth)
    .lte('posted_at', endOfLastMonth);
  if (accountId) lastMonthQuery = lastMonthQuery.eq('account_id', accountId);
  const { data: lastMonthPosts } = await lastMonthQuery;
  const prevPosts = lastMonthPosts || [];

  // Calculate this month's metrics
  const thisMonthPostCount = posts.length;
  const thisMonthImpressions = posts.reduce((sum, p) => sum + (p.impression_count || 0), 0);
  const thisMonthEngagements = posts.reduce((sum, p) =>
    sum + (p.like_count || 0) + (p.retweet_count || 0) + (p.reply_count || 0) + (p.quote_count || 0), 0);
  const thisMonthAvgER = posts.length > 0
    ? posts.reduce((sum, p) => sum + (p.engagement_rate || 0), 0) / posts.length
    : 0;

  // Calculate last month's metrics for comparison
  const lastMonthImpressions = prevPosts.reduce((sum, p) => sum + (p.impression_count || 0), 0);
  const lastMonthAvgER = prevPosts.length > 0
    ? prevPosts.reduce((sum, p) => sum + (p.engagement_rate || 0), 0) / prevPosts.length
    : 0;

  // Follower data
  let followerQuery = sb.from('follower_snapshots')
    .select('follower_count, recorded_at')
    .order('recorded_at', { ascending: false })
    .limit(2);
  if (accountId) followerQuery = followerQuery.eq('account_id', accountId);
  const { data: followerSnapshots } = await followerQuery;

  const currentFollowers = followerSnapshots && followerSnapshots.length > 0
    ? followerSnapshots[0].follower_count : 0;
  const previousFollowers = followerSnapshots && followerSnapshots.length > 1
    ? followerSnapshots[1].follower_count : currentFollowers;
  const followerChange = currentFollowers - previousFollowers;

  // 30-day follower growth
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  let follower30dQuery = sb.from('follower_snapshots')
    .select('follower_count')
    .gte('recorded_at', thirtyDaysAgo.toISOString())
    .order('recorded_at', { ascending: true })
    .limit(1);
  if (accountId) follower30dQuery = follower30dQuery.eq('account_id', accountId);
  const { data: follower30d } = await follower30dQuery;
  const followers30dAgo = follower30d && follower30d.length > 0
    ? follower30d[0].follower_count : currentFollowers;
  const followerGrowth30d = currentFollowers - followers30dAgo;

  // Follower conversion rate: new followers / total impressions
  const followerConversionRate = thisMonthImpressions > 0 && followerGrowth30d > 0
    ? (followerGrowth30d / thisMonthImpressions) * 100
    : 0;

  return {
    // Follower metrics
    currentFollowers,
    followerChange,
    followerGrowth30d,
    followerConversionRate: parseFloat(followerConversionRate.toFixed(4)),

    // Own post metrics
    thisMonthPostCount,
    thisMonthImpressions,
    thisMonthEngagements,
    thisMonthAvgER: parseFloat(thisMonthAvgER.toFixed(2)),

    // Comparison with last month
    lastMonthImpressions,
    impressionChange: thisMonthImpressions - lastMonthImpressions,
    lastMonthAvgER: parseFloat(lastMonthAvgER.toFixed(2)),
    erChange: parseFloat((thisMonthAvgER - lastMonthAvgER).toFixed(2))
  };
}

/**
 * Get own posts with engagement metrics (for the posts table)
 */
async function getOwnPostsPerformance(accountId, limit = 20) {
  const sb = getDb();

  let query = sb.from('my_posts')
    .select('*')
    .eq('status', 'posted')
    .order('posted_at', { ascending: false })
    .limit(limit);
  if (accountId) query = query.eq('account_id', accountId);

  const { data } = await query;
  const posts = data || [];

  // Fetch original tweet info for reply/quote posts
  const targetTweetIds = posts
    .map(p => p.target_tweet_id)
    .filter(Boolean);

  let targetTweetMap = {};
  if (targetTweetIds.length > 0) {
    const { data: targetTweets } = await sb.from('competitor_tweets')
      .select('tweet_id, text, competitor_id, competitors(handle, name)')
      .in('tweet_id', targetTweetIds);
    if (targetTweets) {
      for (const t of targetTweets) {
        targetTweetMap[t.tweet_id] = {
          text: t.text,
          handle: t.competitors?.handle,
          name: t.competitors?.name
        };
      }
    }
  }

  return posts.map(p => ({
    ...p,
    target_tweet: p.target_tweet_id ? (targetTweetMap[p.target_tweet_id] || null) : null
  }));
}

/**
 * Get own posts weekly performance trend
 */
async function getOwnWeeklyTrend(accountId, weeks = 12) {
  const sb = getDb();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - weeks * 7);

  let query = sb.from('my_posts')
    .select('posted_at, engagement_rate, impression_count, like_count, retweet_count, reply_count, quote_count')
    .eq('status', 'posted')
    .gte('posted_at', cutoff.toISOString())
    .not('posted_at', 'is', null);
  if (accountId) query = query.eq('account_id', accountId);

  const { data } = await query;
  if (!data || data.length === 0) return [];

  const weekMap = {};
  for (const row of data) {
    const d = new Date(row.posted_at);
    const year = d.getFullYear();
    const jan1 = new Date(year, 0, 1);
    const weekNum = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
    const weekKey = `${year}-${String(weekNum).padStart(2, '0')}`;

    if (!weekMap[weekKey]) weekMap[weekKey] = { erTotal: 0, impressions: 0, engagements: 0, count: 0 };
    weekMap[weekKey].erTotal += row.engagement_rate || 0;
    weekMap[weekKey].impressions += row.impression_count || 0;
    weekMap[weekKey].engagements += (row.like_count || 0) + (row.retweet_count || 0) + (row.reply_count || 0) + (row.quote_count || 0);
    weekMap[weekKey].count++;
  }

  return Object.entries(weekMap)
    .map(([week, d]) => ({
      week,
      avg_engagement_rate: parseFloat((d.erTotal / d.count).toFixed(2)),
      total_impressions: d.impressions,
      total_engagements: d.engagements,
      post_count: d.count
    }))
    .sort((a, b) => a.week.localeCompare(b.week));
}

module.exports = {
  refreshOwnPostMetrics,
  recordFollowerSnapshot,
  getFollowerGrowth,
  getGrowthDashboard,
  getOwnPostsPerformance,
  getOwnWeeklyTrend
};
