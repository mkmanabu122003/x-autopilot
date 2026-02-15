const { getDb } = require('../db/database');

function calculateEngagementRate(metrics) {
  const { like_count, retweet_count, reply_count, quote_count, impression_count } = metrics;
  if (!impression_count || impression_count === 0) return 0;
  return ((like_count + retweet_count + reply_count + quote_count) / impression_count) * 100;
}

function getDashboardSummary(accountId) {
  const db = getDb();

  const accountFilter = accountId ? 'AND account_id = ?' : '';
  const accountParams = accountId ? [accountId] : [];

  const postCount = db.prepare(`
    SELECT COUNT(*) as count FROM my_posts
    WHERE status = 'posted'
    AND posted_at >= date('now', 'start of month')
    ${accountFilter}
  `).get(...accountParams);

  // Competitor data filtered by account
  let competitorFilter = '';
  if (accountId) {
    competitorFilter = `AND ct.competitor_id IN (SELECT id FROM competitors WHERE account_id = ${Number(accountId)})`;
  }

  const avgEngagement = db.prepare(`
    SELECT AVG(ct.engagement_rate) as avg_rate FROM competitor_tweets ct
    WHERE ct.created_at_x >= date('now', 'start of month')
    ${competitorFilter}
  `).get();

  const totalImpressions = db.prepare(`
    SELECT SUM(ct.impression_count) as total FROM competitor_tweets ct
    WHERE ct.created_at_x >= date('now', 'start of month')
    ${competitorFilter}
  `).get();

  const apiUsage = db.prepare(`
    SELECT SUM(cost_usd) as total_cost FROM api_usage_log
    WHERE created_at >= date('now', 'start of month')
    ${accountFilter}
  `).get(...accountParams);

  const budgetRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('monthly_budget_usd');
  const budget = budgetRow ? parseFloat(budgetRow.value) : 33;

  return {
    myPostCount: postCount.count || 0,
    avgEngagementRate: avgEngagement.avg_rate ? parseFloat(avgEngagement.avg_rate.toFixed(2)) : 0,
    totalImpressions: totalImpressions.total || 0,
    apiCostUsd: apiUsage.total_cost ? parseFloat(apiUsage.total_cost.toFixed(4)) : 0,
    budgetUsd: budget
  };
}

function getTopPosts(limit = 20) {
  const db = getDb();
  return db.prepare(`
    SELECT ct.*, c.handle, c.name as competitor_name
    FROM competitor_tweets ct
    JOIN competitors c ON ct.competitor_id = c.id
    ORDER BY ct.engagement_rate DESC
    LIMIT ?
  `).all(limit);
}

function getHourlyPerformance() {
  const db = getDb();
  return db.prepare(`
    SELECT
      CAST(strftime('%H', created_at_x) AS INTEGER) as hour,
      AVG(engagement_rate) as avg_engagement_rate,
      COUNT(*) as post_count
    FROM competitor_tweets
    WHERE created_at_x IS NOT NULL
    GROUP BY hour
    ORDER BY hour
  `).all();
}

function getWeeklyEngagement(weeks = 12) {
  const db = getDb();
  return db.prepare(`
    SELECT
      strftime('%Y-%W', created_at_x) as week,
      AVG(engagement_rate) as avg_engagement_rate,
      COUNT(*) as post_count
    FROM competitor_tweets
    WHERE created_at_x >= date('now', ?)
    GROUP BY week
    ORDER BY week
  `).all(`-${weeks * 7} days`);
}

function getPostTypePerformance() {
  const db = getDb();
  return db.prepare(`
    SELECT
      CASE
        WHEN has_media = 1 THEN 'media'
        WHEN has_link = 1 THEN 'link'
        WHEN is_thread = 1 THEN 'thread'
        ELSE 'text'
      END as post_type,
      AVG(engagement_rate) as avg_engagement_rate,
      COUNT(*) as post_count
    FROM competitor_tweets
    GROUP BY post_type
    ORDER BY avg_engagement_rate DESC
  `).all();
}

function getCompetitorContext(accountId) {
  const db = getDb();

  let topPostsQuery = `SELECT text, engagement_rate FROM competitor_tweets ORDER BY engagement_rate DESC LIMIT 5`;
  if (accountId) {
    topPostsQuery = `
      SELECT ct.text, ct.engagement_rate FROM competitor_tweets ct
      JOIN competitors c ON ct.competitor_id = c.id
      WHERE c.account_id = ${Number(accountId)}
      ORDER BY ct.engagement_rate DESC LIMIT 5
    `;
  }

  const topPosts = db.prepare(topPostsQuery).all();

  const hourlyData = getHourlyPerformance();
  const bestHours = hourlyData
    .sort((a, b) => b.avg_engagement_rate - a.avg_engagement_rate)
    .slice(0, 3);

  const typeData = getPostTypePerformance();

  let context = '競合で伸びている投稿の特徴:\n';

  if (typeData.length > 0) {
    context += `- 投稿タイプ別: ${typeData.map(t => `${t.post_type}(平均${t.avg_engagement_rate.toFixed(1)}%)`).join(', ')}\n`;
  }

  if (bestHours.length > 0) {
    context += `- 高エンゲージメント時間帯: ${bestHours.map(h => `${h.hour}時`).join(', ')}\n`;
  }

  if (topPosts.length > 0) {
    context += '- 上位ポスト例:\n';
    topPosts.forEach(p => {
      context += `  「${p.text.substring(0, 60)}...」(ER: ${p.engagement_rate.toFixed(1)}%)\n`;
    });
  }

  return context;
}

module.exports = {
  calculateEngagementRate,
  getDashboardSummary,
  getTopPosts,
  getHourlyPerformance,
  getWeeklyEngagement,
  getPostTypePerformance,
  getCompetitorContext
};
