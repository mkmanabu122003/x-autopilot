const { getDb } = require('../db/database');
const { getAIProvider } = require('./ai-provider');
const { logDetailedUsage } = require('./cost-calculator');
const { logInfo, logError } = require('./app-logger');

/**
 * Tweet Improver Service
 *
 * Analyzes posted tweets' engagement performance, generates AI-powered
 * improvement suggestions, and automatically optimizes the tweet generation
 * prompt for future posts.
 *
 * Flow:
 * 1. analyzePostPerformance() - Collect and categorize performance data
 * 2. generateImprovementInsights() - Use AI to analyze and suggest improvements
 * 3. buildPerformanceContextBlock() - Build a prompt block injected at generation time
 * 4. autoAdjustSettings() - Optionally adjust themes/times/tone based on data
 */

// Minimum posts needed before running analysis
const MIN_POSTS_FOR_ANALYSIS = 5;

// How many recent posts to analyze
const ANALYSIS_WINDOW_POSTS = 30;

// Percentile thresholds for top/bottom categorization
const TOP_PERCENTILE = 0.25; // top 25%
const BOTTOM_PERCENTILE = 0.25; // bottom 25%

/**
 * Analyze the engagement performance of own posted tweets.
 * Returns structured data about top/bottom performers and identified patterns.
 */
async function analyzePostPerformance(accountId) {
  const sb = getDb();

  // Fetch posted tweets with engagement metrics
  let query = sb.from('my_posts')
    .select('id, text, post_type, theme_category, engagement_rate, like_count, retweet_count, reply_count, quote_count, impression_count, bookmark_count, ai_provider, ai_model, posted_at')
    .eq('status', 'posted')
    .not('engagement_rate', 'is', null)
    .gt('impression_count', 0);

  if (accountId) query = query.eq('account_id', accountId);

  const { data: posts, error } = await query
    .order('posted_at', { ascending: false })
    .limit(ANALYSIS_WINDOW_POSTS);
  if (error) throw new Error(`投稿データの取得に失敗: ${error.message}`);
  if (!posts || posts.length < MIN_POSTS_FOR_ANALYSIS) {
    return {
      status: 'insufficient_data',
      postCount: posts ? posts.length : 0,
      minRequired: MIN_POSTS_FOR_ANALYSIS,
      message: `分析には最低${MIN_POSTS_FOR_ANALYSIS}件の投稿データが必要です（現在: ${posts ? posts.length : 0}件）`
    };
  }

  // Sort by engagement_rate descending
  const sorted = [...posts].sort((a, b) => (b.engagement_rate || 0) - (a.engagement_rate || 0));
  const topCount = Math.max(1, Math.floor(sorted.length * TOP_PERCENTILE));
  const bottomCount = Math.max(1, Math.floor(sorted.length * BOTTOM_PERCENTILE));

  const topPosts = sorted.slice(0, topCount);
  const bottomPosts = sorted.slice(-bottomCount);

  // Calculate overall stats
  const avgER = posts.reduce((sum, p) => sum + (p.engagement_rate || 0), 0) / posts.length;
  const avgImpressions = posts.reduce((sum, p) => sum + (p.impression_count || 0), 0) / posts.length;
  const avgLikes = posts.reduce((sum, p) => sum + (p.like_count || 0), 0) / posts.length;

  // Analyze patterns in top vs bottom posts
  const topPatterns = extractPatterns(topPosts);
  const bottomPatterns = extractPatterns(bottomPosts);

  // Analyze posting time patterns
  const timeAnalysis = analyzePostingTimes(posts);

  // Analyze theme category performance
  const categoryAnalysis = analyzeCategoryPerformance(posts);

  // Analyze text features
  const textAnalysis = analyzeTextFeatures(topPosts, bottomPosts);

  return {
    status: 'ok',
    postCount: posts.length,
    overallStats: {
      avgEngagementRate: parseFloat(avgER.toFixed(2)),
      avgImpressions: Math.round(avgImpressions),
      avgLikes: parseFloat(avgLikes.toFixed(1))
    },
    topPosts: topPosts.map(summarizePost),
    bottomPosts: bottomPosts.map(summarizePost),
    topPatterns,
    bottomPatterns,
    timeAnalysis,
    categoryAnalysis,
    textAnalysis
  };
}

/**
 * Extract structural and content patterns from a set of posts.
 */
function extractPatterns(posts) {
  const themes = {};
  const postTypes = {};

  for (const post of posts) {
    if (post.theme_category) {
      themes[post.theme_category] = (themes[post.theme_category] || 0) + 1;
    }
    if (post.post_type) {
      postTypes[post.post_type] = (postTypes[post.post_type] || 0) + 1;
    }
  }

  return {
    themes: Object.entries(themes)
      .sort(([, a], [, b]) => b - a)
      .map(([theme, count]) => ({ theme, count })),
    postTypes: Object.entries(postTypes)
      .sort(([, a], [, b]) => b - a)
      .map(([type, count]) => ({ type, count }))
  };
}

/**
 * Analyze which posting times perform best.
 */
function analyzePostingTimes(posts) {
  const hourBuckets = {};

  for (const post of posts) {
    if (!post.posted_at) continue;
    const hour = new Date(post.posted_at).getUTCHours();
    // Convert to JST
    const jstHour = (hour + 9) % 24;
    if (!hourBuckets[jstHour]) {
      hourBuckets[jstHour] = { totalER: 0, count: 0, totalImpressions: 0 };
    }
    hourBuckets[jstHour].totalER += post.engagement_rate || 0;
    hourBuckets[jstHour].totalImpressions += post.impression_count || 0;
    hourBuckets[jstHour].count++;
  }

  const hourlyPerformance = Object.entries(hourBuckets)
    .map(([hour, data]) => ({
      hour: parseInt(hour),
      avgEngagementRate: parseFloat((data.totalER / data.count).toFixed(2)),
      avgImpressions: Math.round(data.totalImpressions / data.count),
      postCount: data.count
    }))
    .sort((a, b) => b.avgEngagementRate - a.avgEngagementRate);

  const bestHours = hourlyPerformance.slice(0, 3).map(h => h.hour);
  const worstHours = hourlyPerformance.slice(-3).map(h => h.hour);

  return { hourlyPerformance, bestHours, worstHours };
}

/**
 * Analyze theme category performance.
 */
function analyzeCategoryPerformance(posts) {
  const categoryBuckets = {};

  for (const post of posts) {
    const cat = post.theme_category || 'uncategorized';
    if (!categoryBuckets[cat]) {
      categoryBuckets[cat] = { totalER: 0, count: 0, totalImpressions: 0 };
    }
    categoryBuckets[cat].totalER += post.engagement_rate || 0;
    categoryBuckets[cat].totalImpressions += post.impression_count || 0;
    categoryBuckets[cat].count++;
  }

  return Object.entries(categoryBuckets)
    .map(([category, data]) => ({
      category,
      avgEngagementRate: parseFloat((data.totalER / data.count).toFixed(2)),
      avgImpressions: Math.round(data.totalImpressions / data.count),
      postCount: data.count
    }))
    .sort((a, b) => b.avgEngagementRate - a.avgEngagementRate);
}

/**
 * Analyze text-level features of top vs bottom performing posts.
 */
function analyzeTextFeatures(topPosts, bottomPosts) {
  const topAvgLength = topPosts.reduce((sum, p) => sum + (p.text || '').length, 0) / topPosts.length;
  const bottomAvgLength = bottomPosts.reduce((sum, p) => sum + (p.text || '').length, 0) / bottomPosts.length;

  // Check for question marks (engagement driver)
  const topHasQuestion = topPosts.filter(p => (p.text || '').includes('？') || (p.text || '').includes('?')).length;
  const bottomHasQuestion = bottomPosts.filter(p => (p.text || '').includes('？') || (p.text || '').includes('?')).length;

  // Check for quotes (guest dialogue)
  const topHasQuotes = topPosts.filter(p => (p.text || '').includes('「')).length;
  const bottomHasQuotes = bottomPosts.filter(p => (p.text || '').includes('「')).length;

  // Check for numbers (concrete data)
  const topHasNumbers = topPosts.filter(p => /\d/.test(p.text || '')).length;
  const bottomHasNumbers = bottomPosts.filter(p => /\d/.test(p.text || '')).length;

  // Check for line breaks (readability)
  const topAvgLineBreaks = topPosts.reduce((sum, p) => sum + ((p.text || '').match(/\n/g) || []).length, 0) / topPosts.length;
  const bottomAvgLineBreaks = bottomPosts.reduce((sum, p) => sum + ((p.text || '').match(/\n/g) || []).length, 0) / bottomPosts.length;

  return {
    avgLength: {
      top: Math.round(topAvgLength),
      bottom: Math.round(bottomAvgLength)
    },
    hasQuestion: {
      topRate: parseFloat((topHasQuestion / topPosts.length * 100).toFixed(0)),
      bottomRate: parseFloat((bottomHasQuestion / bottomPosts.length * 100).toFixed(0))
    },
    hasQuotes: {
      topRate: parseFloat((topHasQuotes / topPosts.length * 100).toFixed(0)),
      bottomRate: parseFloat((bottomHasQuotes / bottomPosts.length * 100).toFixed(0))
    },
    hasNumbers: {
      topRate: parseFloat((topHasNumbers / topPosts.length * 100).toFixed(0)),
      bottomRate: parseFloat((bottomHasNumbers / bottomPosts.length * 100).toFixed(0))
    },
    avgLineBreaks: {
      top: parseFloat(topAvgLineBreaks.toFixed(1)),
      bottom: parseFloat(bottomAvgLineBreaks.toFixed(1))
    }
  };
}

/**
 * Summarize a post for display/analysis output.
 */
function summarizePost(post) {
  return {
    id: post.id,
    text: post.text ? (post.text.length > 100 ? post.text.substring(0, 100) + '...' : post.text) : '',
    engagementRate: post.engagement_rate,
    impressions: post.impression_count,
    likes: post.like_count,
    retweets: post.retweet_count,
    replies: post.reply_count,
    themeCategory: post.theme_category,
    postedAt: post.posted_at
  };
}

/**
 * Generate AI-powered improvement insights based on performance analysis.
 * Uses the AI provider to analyze patterns and generate actionable suggestions.
 */
async function generateImprovementInsights(accountId, providerName, modelId) {
  const analysis = await analyzePostPerformance(accountId);

  if (analysis.status === 'insufficient_data') {
    return {
      status: 'insufficient_data',
      message: analysis.message,
      suggestions: []
    };
  }

  // Resolve AI provider
  const provider = getAIProvider(providerName || 'claude');

  const analysisPrompt = buildAnalysisPrompt(analysis);

  const opts = {
    taskType: 'performance_summary',
    accountId,
    customPrompt: analysisPrompt
  };
  if (modelId) {
    opts.model = modelId;
  }

  const result = await provider.generateTweets('パフォーマンス分析', opts);

  // Parse the AI response for structured suggestions
  const responseText = result.candidates?.[0]?.text || '';
  const suggestions = parseImprovementSuggestions(responseText);

  // Save the analysis and suggestions to DB
  const savedAnalysis = await saveAnalysis(accountId, analysis, suggestions);

  logInfo('tweet_improver', `改善分析を実行 (アカウント: ${accountId})`, {
    postCount: analysis.postCount,
    suggestionsCount: suggestions.length
  });

  return {
    status: 'ok',
    analysisId: savedAnalysis?.id || null,
    analysis,
    suggestions,
    rawInsights: responseText
  };
}

/**
 * Build a detailed analysis prompt for the AI.
 */
function buildAnalysisPrompt(analysis) {
  const topPostTexts = analysis.topPosts
    .map((p, i) => `${i + 1}. [ER: ${p.engagementRate?.toFixed(1)}%, imp: ${p.impressions}] ${p.text}`)
    .join('\n');

  const bottomPostTexts = analysis.bottomPosts
    .map((p, i) => `${i + 1}. [ER: ${p.engagementRate?.toFixed(1)}%, imp: ${p.impressions}] ${p.text}`)
    .join('\n');

  const catAnalysis = analysis.categoryAnalysis
    .map(c => `- ${c.category}: 平均ER ${c.avgEngagementRate}% (${c.postCount}件)`)
    .join('\n');

  const timeAnalysis = analysis.timeAnalysis.hourlyPerformance
    .slice(0, 5)
    .map(h => `- ${h.hour}時: 平均ER ${h.avgEngagementRate}% (${h.postCount}件)`)
    .join('\n');

  const textFeatures = analysis.textAnalysis;

  return `以下の自分のツイートパフォーマンスデータを分析して、具体的な改善提案を生成してください。

# 全体統計
- 分析対象: ${analysis.postCount}件
- 平均エンゲージメント率: ${analysis.overallStats.avgEngagementRate}%
- 平均インプレッション: ${analysis.overallStats.avgImpressions}
- 平均いいね数: ${analysis.overallStats.avgLikes}

# 高パフォーマンス投稿（上位25%）
${topPostTexts}

# 低パフォーマンス投稿（下位25%）
${bottomPostTexts}

# テーマカテゴリ別パフォーマンス
${catAnalysis}

# 時間帯別パフォーマンス（JST、上位5）
${timeAnalysis}

# テキスト特徴分析
- 文字数: 高パフォ平均 ${textFeatures.avgLength.top}字 / 低パフォ平均 ${textFeatures.avgLength.bottom}字
- 問いかけ含有率: 高パフォ ${textFeatures.hasQuestion.topRate}% / 低パフォ ${textFeatures.hasQuestion.bottomRate}%
- 引用（「」）含有率: 高パフォ ${textFeatures.hasQuotes.topRate}% / 低パフォ ${textFeatures.hasQuotes.bottomRate}%
- 数字含有率: 高パフォ ${textFeatures.hasNumbers.topRate}% / 低パフォ ${textFeatures.hasNumbers.bottomRate}%
- 平均改行数: 高パフォ ${textFeatures.avgLineBreaks.top}回 / 低パフォ ${textFeatures.avgLineBreaks.bottom}回

# 出力形式
以下のJSON形式で改善提案を返してください。コードフェンスは付けないこと。
{"suggestions":[{"category":"content|timing|style|theme","priority":"high|medium|low","title":"改善点のタイトル（1行）","description":"具体的な改善内容と根拠（2-3文）","action":"次回から実行するアクション（1文）"}]}

注意:
- データに基づいた具体的な提案をすること（「もっと頑張りましょう」のような抽象的な提案は不要）
- 高パフォーマンス投稿の共通点を活かす提案を含めること
- 低パフォーマンス投稿の問題点を避ける提案を含めること
- 3〜7件の提案を出すこと`;
}

/**
 * Parse AI response into structured improvement suggestions.
 */
function parseImprovementSuggestions(text) {
  // Try JSON parse
  try {
    const cleaned = text.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
      return parsed.suggestions.map(s => ({
        category: s.category || 'content',
        priority: s.priority || 'medium',
        title: s.title || '',
        description: s.description || '',
        action: s.action || ''
      }));
    }
  } catch (e) {
    // Try to extract JSON from text
    try {
      const jsonMatch = text.match(/\{[\s\S]*"suggestions"[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.suggestions && Array.isArray(parsed.suggestions)) {
          return parsed.suggestions.map(s => ({
            category: s.category || 'content',
            priority: s.priority || 'medium',
            title: s.title || '',
            description: s.description || '',
            action: s.action || ''
          }));
        }
      }
    } catch (e2) {
      // Fall through
    }
  }

  // Fallback: return raw text as a single suggestion
  if (text.trim()) {
    return [{
      category: 'content',
      priority: 'medium',
      title: '改善分析結果',
      description: text.trim().substring(0, 500),
      action: '詳細を確認して手動で対応してください'
    }];
  }

  return [];
}

/**
 * Save analysis results to DB.
 */
async function saveAnalysis(accountId, analysis, suggestions) {
  try {
    const sb = getDb();
    const { data, error } = await sb.from('improvement_analyses').insert({
      account_id: accountId,
      post_count: analysis.postCount,
      avg_engagement_rate: analysis.overallStats.avgEngagementRate,
      avg_impressions: analysis.overallStats.avgImpressions,
      top_posts: analysis.topPosts,
      bottom_posts: analysis.bottomPosts,
      category_analysis: analysis.categoryAnalysis,
      time_analysis: analysis.timeAnalysis,
      text_analysis: analysis.textAnalysis,
      suggestions
    }).select('id').single();

    if (error) {
      console.warn('tweet-improver: failed to save analysis:', error.message);
      return null;
    }
    return data;
  } catch (err) {
    console.warn('tweet-improver: error saving analysis:', err.message);
    return null;
  }
}

/**
 * Build a performance context block to inject into the tweet generation prompt.
 * This is the core feedback loop: past performance data shapes future generation.
 *
 * Returns an empty string if insufficient data or no analysis exists.
 */
async function buildPerformanceContextBlock(accountId) {
  try {
    const analysis = await analyzePostPerformance(accountId);
    if (analysis.status === 'insufficient_data') return '';

    const parts = [];
    parts.push('\n## パフォーマンスフィードバック（過去の投稿分析結果に基づく自動指示）');

    // Overall stats
    parts.push(`直近${analysis.postCount}件の平均ER: ${analysis.overallStats.avgEngagementRate}%`);

    // Top performing post insights
    if (analysis.topPosts.length > 0) {
      parts.push('\n### 高パフォーマンス投稿の特徴（これらの要素を積極的に取り入れること）');
      for (const post of analysis.topPosts.slice(0, 3)) {
        parts.push(`- ER ${post.engagementRate?.toFixed(1)}%: 「${post.text}」`);
      }
    }

    // Text feature insights
    const tf = analysis.textAnalysis;
    const insights = [];

    if (tf.avgLength.top !== tf.avgLength.bottom) {
      const betterLength = tf.avgLength.top;
      insights.push(`文字数は${betterLength}字前後が効果的`);
    }
    if (tf.hasQuestion.topRate > tf.hasQuestion.bottomRate + 20) {
      insights.push('問いかけ（？）を含めるとエンゲージメントが上がる傾向');
    }
    if (tf.hasQuotes.topRate > tf.hasQuotes.bottomRate + 20) {
      insights.push('ゲストの言葉の引用（「」）を含めると反応が良い');
    }
    if (tf.hasNumbers.topRate > tf.hasNumbers.bottomRate + 20) {
      insights.push('具体的な数字を含めると反応が良い');
    }

    if (insights.length > 0) {
      parts.push('\n### データから判明した効果的な要素');
      for (const insight of insights) {
        parts.push(`- ${insight}`);
      }
    }

    // Bottom performing post warnings
    if (analysis.bottomPosts.length > 0) {
      parts.push('\n### 避けるべきパターン（低パフォーマンス投稿に共通する特徴）');
      for (const post of analysis.bottomPosts.slice(0, 2)) {
        parts.push(`- ER ${post.engagementRate?.toFixed(1)}%: 「${post.text}」`);
      }
    }

    // Theme category recommendations
    if (analysis.categoryAnalysis.length > 1) {
      const bestCat = analysis.categoryAnalysis[0];
      const worstCat = analysis.categoryAnalysis[analysis.categoryAnalysis.length - 1];
      if (bestCat.avgEngagementRate > worstCat.avgEngagementRate) {
        parts.push(`\n### テーマ推奨`);
        parts.push(`- 高ER テーマ: ${bestCat.category}（平均ER ${bestCat.avgEngagementRate}%）→ 優先的に扱う`);
        if (worstCat.category !== bestCat.category) {
          parts.push(`- 低ER テーマ: ${worstCat.category}（平均ER ${worstCat.avgEngagementRate}%）→ 切り口を変えて改善`);
        }
      }
    }

    return parts.join('\n');
  } catch (err) {
    console.warn('tweet-improver: error building performance context:', err.message);
    return '';
  }
}

/**
 * Get the latest analysis for an account from the DB.
 */
async function getLatestAnalysis(accountId) {
  try {
    const sb = getDb();
    let query = sb.from('improvement_analyses')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);
    if (accountId) query = query.eq('account_id', accountId);

    const { data, error } = await query;
    if (error) throw error;
    return data && data.length > 0 ? data[0] : null;
  } catch (err) {
    console.warn('tweet-improver: error fetching latest analysis:', err.message);
    return null;
  }
}

/**
 * Get analysis history for an account.
 */
async function getAnalysisHistory(accountId, limit = 10) {
  try {
    const sb = getDb();
    let query = sb.from('improvement_analyses')
      .select('id, account_id, post_count, avg_engagement_rate, avg_impressions, suggestions, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (accountId) query = query.eq('account_id', accountId);

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  } catch (err) {
    console.warn('tweet-improver: error fetching analysis history:', err.message);
    return [];
  }
}

/**
 * Auto-adjust auto_post_settings based on performance analysis.
 * Adjusts: schedule_times (based on best posting hours) and
 * theme weighting (via style_note suggestions).
 *
 * Returns the adjustments made (if any).
 */
async function autoAdjustSettings(accountId) {
  const analysis = await analyzePostPerformance(accountId);
  if (analysis.status === 'insufficient_data') {
    return { adjusted: false, reason: analysis.message };
  }

  const adjustments = [];
  const sb = getDb();

  // 1. Adjust posting times based on performance data
  const bestHours = analysis.timeAnalysis.bestHours;
  if (bestHours.length >= 2) {
    const suggestedTimes = bestHours
      .slice(0, 3)
      .map(h => `${String(h).padStart(2, '0')}:00`)
      .join(',');

    const { data: settings } = await sb.from('auto_post_settings')
      .select('id, schedule_times')
      .eq('account_id', accountId)
      .eq('post_type', 'new')
      .eq('enabled', true)
      .limit(1);

    if (settings && settings.length > 0) {
      const current = settings[0];
      if (current.schedule_times !== suggestedTimes) {
        await sb.from('auto_post_settings')
          .update({
            schedule_times: suggestedTimes,
            updated_at: new Date().toISOString()
          })
          .eq('id', current.id);

        adjustments.push({
          type: 'schedule_times',
          from: current.schedule_times,
          to: suggestedTimes,
          reason: `パフォーマンスデータに基づき最適な投稿時間に変更: ${bestHours.map(h => h + '時').join(', ')}`
        });
      }
    }
  }

  // 2. Update style_note with performance-based guidance
  if (analysis.textAnalysis) {
    const tf = analysis.textAnalysis;
    const styleNotes = [];

    if (tf.avgLength.top > 0) {
      styleNotes.push(`最適文字数: ${tf.avgLength.top}字前後`);
    }
    if (tf.hasQuestion.topRate > tf.hasQuestion.bottomRate + 20) {
      styleNotes.push('問いかけ（？）を含める');
    }
    if (tf.hasQuotes.topRate > tf.hasQuotes.bottomRate + 20) {
      styleNotes.push('ゲストの引用（「」）を活用する');
    }

    if (styleNotes.length > 0) {
      const performanceNote = `[自動分析] ${styleNotes.join(' / ')}`;
      const { data: settings } = await sb.from('auto_post_settings')
        .select('id, style_note')
        .eq('account_id', accountId)
        .eq('post_type', 'new')
        .eq('enabled', true)
        .limit(1);

      if (settings && settings.length > 0) {
        const current = settings[0];
        // Only update if auto-analysis note is different
        const existingAutoNote = (current.style_note || '').match(/\[自動分析\].*$/)?.[0] || '';
        if (existingAutoNote !== performanceNote) {
          const baseNote = (current.style_note || '').replace(/\[自動分析\].*$/, '').trim();
          const newNote = baseNote ? `${baseNote}\n${performanceNote}` : performanceNote;

          await sb.from('auto_post_settings')
            .update({
              style_note: newNote,
              updated_at: new Date().toISOString()
            })
            .eq('id', current.id);

          adjustments.push({
            type: 'style_note',
            from: current.style_note,
            to: newNote,
            reason: 'パフォーマンスデータに基づくスタイル指示の自動更新'
          });
        }
      }
    }
  }

  // Log adjustments
  if (adjustments.length > 0) {
    try {
      await sb.from('improvement_analyses')
        .update({ adjustments_applied: adjustments })
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .limit(1);
    } catch (e) {
      // Non-critical
    }

    logInfo('tweet_improver', `自動設定調整を実施 (アカウント: ${accountId})`, {
      adjustmentCount: adjustments.length,
      adjustments
    });
  }

  return {
    adjusted: adjustments.length > 0,
    adjustments
  };
}

module.exports = {
  analyzePostPerformance,
  generateImprovementInsights,
  buildPerformanceContextBlock,
  getLatestAnalysis,
  getAnalysisHistory,
  autoAdjustSettings,
  // Exported for testing
  extractPatterns,
  analyzePostingTimes,
  analyzeCategoryPerformance,
  analyzeTextFeatures,
  parseImprovementSuggestions,
  summarizePost,
  buildAnalysisPrompt,
  MIN_POSTS_FOR_ANALYSIS,
  ANALYSIS_WINDOW_POSTS,
  TOP_PERCENTILE,
  BOTTOM_PERCENTILE
};
