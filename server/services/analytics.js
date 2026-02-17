const { getDb } = require('../db/database');
const { getManuallyEngagedTweetIds } = require('./x-api');

function calculateEngagementRate(metrics) {
  const { like_count, retweet_count, reply_count, quote_count, impression_count } = metrics;
  if (!impression_count || impression_count === 0) return 0;
  return ((like_count + retweet_count + reply_count + quote_count) / impression_count) * 100;
}

async function getDashboardSummary(accountId) {
  const sb = getDb();
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  // Post count this month
  let postQuery = sb.from('my_posts').select('*', { count: 'exact', head: true })
    .eq('status', 'posted')
    .gte('posted_at', startOfMonth);
  if (accountId) postQuery = postQuery.eq('account_id', accountId);
  const { count: postCount } = await postQuery;

  // Competitor tweets this month for engagement rate
  let competitorIds = null;
  if (accountId) {
    const { data: comps } = await sb.from('competitors').select('id').eq('account_id', accountId);
    competitorIds = comps ? comps.map(c => c.id) : [];
  }

  let avgEngagementRate = 0;
  let totalImpressions = 0;

  if (!competitorIds || competitorIds.length > 0) {
    let engQuery = sb.from('competitor_tweets')
      .select('engagement_rate, impression_count')
      .gte('created_at_x', startOfMonth);
    if (competitorIds && competitorIds.length > 0) {
      engQuery = engQuery.in('competitor_id', competitorIds);
    }

    const { data: engData } = await engQuery;
    if (engData && engData.length > 0) {
      const sum = engData.reduce((acc, r) => acc + (r.engagement_rate || 0), 0);
      avgEngagementRate = parseFloat((sum / engData.length).toFixed(2));
      totalImpressions = engData.reduce((acc, r) => acc + (r.impression_count || 0), 0);
    }
  }

  // API cost this month
  let costQuery = sb.from('api_usage_log').select('cost_usd').gte('created_at', startOfMonth);
  if (accountId) costQuery = costQuery.eq('account_id', accountId);
  const { data: costData } = await costQuery;
  const apiCost = costData ? costData.reduce((acc, r) => acc + (r.cost_usd || 0), 0) : 0;

  const { data: budgetRow } = await sb.from('settings').select('value').eq('key', 'monthly_budget_usd').single();
  const budget = budgetRow ? parseFloat(budgetRow.value) : 33;

  return {
    myPostCount: postCount || 0,
    avgEngagementRate,
    totalImpressions,
    apiCostUsd: parseFloat(apiCost.toFixed(4)),
    budgetUsd: budget
  };
}

async function getTopPosts(limit = 20) {
  const sb = getDb();
  const { data, error } = await sb.from('competitor_tweets')
    .select('*, competitors(handle, name)')
    .order('engagement_rate', { ascending: false })
    .limit(limit);
  if (error) throw error;

  return (data || []).map(t => ({
    ...t,
    handle: t.competitors?.handle,
    competitor_name: t.competitors?.name,
    competitors: undefined
  }));
}

async function getHourlyPerformance() {
  const sb = getDb();
  const { data } = await sb.from('competitor_tweets')
    .select('created_at_x, engagement_rate')
    .not('created_at_x', 'is', null);

  if (!data || data.length === 0) return [];

  const hourMap = {};
  for (const row of data) {
    const hour = new Date(row.created_at_x).getUTCHours();
    if (!hourMap[hour]) hourMap[hour] = { total: 0, count: 0 };
    hourMap[hour].total += row.engagement_rate || 0;
    hourMap[hour].count++;
  }

  return Object.entries(hourMap)
    .map(([hour, { total, count }]) => ({
      hour: parseInt(hour),
      avg_engagement_rate: parseFloat((total / count).toFixed(2)),
      post_count: count
    }))
    .sort((a, b) => a.hour - b.hour);
}

async function getWeeklyEngagement(weeks = 12) {
  const sb = getDb();
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - weeks * 7);

  const { data } = await sb.from('competitor_tweets')
    .select('created_at_x, engagement_rate')
    .gte('created_at_x', cutoffDate.toISOString());

  if (!data || data.length === 0) return [];

  const weekMap = {};
  for (const row of data) {
    const d = new Date(row.created_at_x);
    const year = d.getFullYear();
    const jan1 = new Date(year, 0, 1);
    const weekNum = Math.ceil(((d - jan1) / 86400000 + jan1.getDay() + 1) / 7);
    const weekKey = `${year}-${String(weekNum).padStart(2, '0')}`;

    if (!weekMap[weekKey]) weekMap[weekKey] = { total: 0, count: 0 };
    weekMap[weekKey].total += row.engagement_rate || 0;
    weekMap[weekKey].count++;
  }

  return Object.entries(weekMap)
    .map(([week, { total, count }]) => ({
      week,
      avg_engagement_rate: parseFloat((total / count).toFixed(2)),
      post_count: count
    }))
    .sort((a, b) => a.week.localeCompare(b.week));
}

async function getPostTypePerformance() {
  const sb = getDb();
  const { data } = await sb.from('competitor_tweets')
    .select('has_media, has_link, is_thread, engagement_rate');

  if (!data || data.length === 0) return [];

  const typeMap = {};
  for (const row of data) {
    let postType = 'text';
    if (row.has_media) postType = 'media';
    else if (row.has_link) postType = 'link';
    else if (row.is_thread) postType = 'thread';

    if (!typeMap[postType]) typeMap[postType] = { total: 0, count: 0 };
    typeMap[postType].total += row.engagement_rate || 0;
    typeMap[postType].count++;
  }

  return Object.entries(typeMap)
    .map(([post_type, { total, count }]) => ({
      post_type,
      avg_engagement_rate: parseFloat((total / count).toFixed(2)),
      post_count: count
    }))
    .sort((a, b) => b.avg_engagement_rate - a.avg_engagement_rate);
}

async function getCompetitorContext(accountId) {
  const sb = getDb();

  let topPostsQuery = sb.from('competitor_tweets')
    .select('text, engagement_rate')
    .order('engagement_rate', { ascending: false })
    .limit(5);

  if (accountId) {
    const { data: comps } = await sb.from('competitors').select('id').eq('account_id', accountId);
    const compIds = comps ? comps.map(c => c.id) : [];
    if (compIds.length > 0) {
      topPostsQuery = topPostsQuery.in('competitor_id', compIds);
    }
  }

  const { data: topPosts } = await topPostsQuery;

  const hourlyData = await getHourlyPerformance();
  const bestHours = [...hourlyData]
    .sort((a, b) => b.avg_engagement_rate - a.avg_engagement_rate)
    .slice(0, 3);

  const typeData = await getPostTypePerformance();

  let context = '競合で伸びている投稿の特徴:\n';

  if (typeData.length > 0) {
    context += `- 投稿タイプ別: ${typeData.map(t => `${t.post_type}(平均${t.avg_engagement_rate.toFixed(1)}%)`).join(', ')}\n`;
  }
  if (bestHours.length > 0) {
    context += `- 高エンゲージメント時間帯: ${bestHours.map(h => `${h.hour}時`).join(', ')}\n`;
  }
  if (topPosts && topPosts.length > 0) {
    context += '- 上位ポスト例:\n';
    topPosts.forEach(p => {
      const displayText = p.text.length > 100 ? p.text.substring(0, 100) + '...' : p.text;
      context += `  「${displayText}」(ER: ${p.engagement_rate.toFixed(1)}%)\n`;
    });
  }

  return context;
}

/**
 * Collect all tweet IDs the user has engaged with (replied to / quoted),
 * from both the app's DB and manual X activity.
 */
async function getAllEngagedTweetIds(accountId) {
  const sb = getDb();

  // 1. Get tweet_ids engaged via the app (drafts, scheduled, posted)
  let engagedQuery = sb.from('my_posts')
    .select('target_tweet_id')
    .in('post_type', ['reply', 'quote'])
    .not('target_tweet_id', 'is', null);
  if (accountId) engagedQuery = engagedQuery.eq('account_id', accountId);
  const { data: engagedRows } = await engagedQuery;
  const dbIds = (engagedRows || []).map(r => r.target_tweet_id).filter(Boolean);

  // 2. Get tweet_ids the user manually replied to / quoted on X
  let xIds = [];
  if (accountId) {
    xIds = await getManuallyEngagedTweetIds(accountId);
  }

  // Merge and deduplicate
  return [...new Set([...dbIds, ...xIds])];
}

async function getQuoteSuggestions(accountId, options = {}) {
  const sb = getDb();
  const limit = options.limit || 10;
  const minEngagementRate = options.minEngagementRate || 0;

  const engagedIds = await getAllEngagedTweetIds(accountId);

  // Get competitor IDs for this account
  let competitorIds = null;
  if (accountId) {
    const { data: comps } = await sb.from('competitors').select('id').eq('account_id', accountId);
    competitorIds = comps ? comps.map(c => c.id) : [];
    if (competitorIds.length === 0) return [];
  }

  // Fetch top tweets by engagement, excluding already-engaged
  let query = sb.from('competitor_tweets')
    .select('*, competitors(handle, name)')
    .gte('engagement_rate', minEngagementRate)
    .order('engagement_rate', { ascending: false })
    .limit(limit + engagedIds.length);

  if (competitorIds) query = query.in('competitor_id', competitorIds);
  const { data, error } = await query;
  if (error) throw error;

  const suggestions = (data || [])
    .filter(t => !engagedIds.includes(t.tweet_id))
    .slice(0, limit)
    .map(t => ({
      ...t,
      handle: t.competitors?.handle,
      competitor_name: t.competitors?.name,
      competitors: undefined
    }));

  return suggestions;
}

async function getReplySuggestions(accountId, options = {}) {
  const sb = getDb();
  const limit = options.limit || 10;
  const minEngagementRate = options.minEngagementRate || 0;

  const engagedIds = await getAllEngagedTweetIds(accountId);

  // Get competitor IDs for this account
  let competitorIds = null;
  if (accountId) {
    const { data: comps } = await sb.from('competitors').select('id').eq('account_id', accountId);
    competitorIds = comps ? comps.map(c => c.id) : [];
    if (competitorIds.length === 0) return [];
  }

  // Fetch top tweets by engagement, excluding already-engaged
  let query = sb.from('competitor_tweets')
    .select('*, competitors(handle, name)')
    .gte('engagement_rate', minEngagementRate)
    .order('engagement_rate', { ascending: false })
    .limit(limit + engagedIds.length);

  if (competitorIds) query = query.in('competitor_id', competitorIds);
  const { data, error } = await query;
  if (error) throw error;

  const suggestions = (data || [])
    .filter(t => !engagedIds.includes(t.tweet_id))
    .slice(0, limit)
    .map(t => ({
      ...t,
      handle: t.competitors?.handle,
      competitor_name: t.competitors?.name,
      competitors: undefined
    }));

  return suggestions;
}

module.exports = {
  calculateEngagementRate,
  getDashboardSummary,
  getTopPosts,
  getHourlyPerformance,
  getWeeklyEngagement,
  getPostTypePerformance,
  getCompetitorContext,
  getQuoteSuggestions,
  getReplySuggestions
};
