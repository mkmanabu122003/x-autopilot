const { getDb } = require('../db/database');
const { getAIProvider } = require('./ai-provider');
const { postTweet } = require('./x-api');
const { getQuoteSuggestions, getReplySuggestions, getCompetitorContext } = require('./analytics');

/**
 * Auto-poster service: generates and schedules/posts content automatically
 * based on auto_post_settings configuration.
 *
 * Flow:
 * 1. Scheduler calls checkAndRunAutoPosts() every minute
 * 2. For each enabled setting where current time matches a schedule_time:
 *    - Generate content via AI
 *    - For reply/quote: auto-select target tweets from competitors
 *    - scheduled mode: create scheduled posts spread throughout the day
 *    - immediate mode: post directly via X API
 */

async function checkAndRunAutoPosts() {
  const sb = getDb();
  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const today = now.toISOString().slice(0, 10);

  // Fetch all enabled auto_post_settings
  const { data: allSettings, error } = await sb.from('auto_post_settings')
    .select('*, x_accounts(display_name, handle, default_ai_provider, default_ai_model)')
    .eq('enabled', true);

  if (error) {
    console.error('AutoPoster: failed to query settings:', error.message);
    return;
  }
  if (!allSettings || allSettings.length === 0) return;

  for (const setting of allSettings) {
    try {
      const times = (setting.schedule_times || '').split(',').map(t => t.trim());
      if (!times.includes(currentTime)) continue;

      // Check if this specific time slot has already been run today
      const ranTimes = (setting.last_run_times || '').split(',').map(t => t.trim()).filter(Boolean);
      if (setting.last_run_date === today && ranTimes.includes(currentTime)) continue;

      console.log(`AutoPoster: running ${setting.post_type} for account ${setting.account_id} at ${currentTime}`);

      // Calculate how many posts for this time slot
      const postsForSlot = Math.ceil(setting.posts_per_day / times.length);

      await executeAutoPost(setting, postsForSlot, currentTime);

      // Update last_run tracking
      const updatedTimes = setting.last_run_date === today
        ? [...ranTimes, currentTime].join(',')
        : currentTime;

      await sb.from('auto_post_settings')
        .update({
          last_run_date: today,
          last_run_times: updatedTimes
        })
        .eq('id', setting.id);

    } catch (err) {
      console.error(`AutoPoster: error processing setting ${setting.id}:`, err.message);
      await logAutoPostExecution(setting.account_id, setting.post_type, 0, 0, 0, 'failed', err.message);
    }
  }
}

async function executeAutoPost(setting, count, currentTime, { forcePreview = false } = {}) {
  const accountId = setting.account_id;
  const provider = getAIProvider(
    setting.x_accounts?.default_ai_provider || 'claude'
  );

  switch (setting.post_type) {
    case 'new':
      return await executeNewTweets(setting, provider, count, currentTime, forcePreview);
    case 'reply':
      return await executeReplies(setting, provider, count, currentTime, forcePreview);
    case 'quote':
      return await executeQuotes(setting, provider, count, currentTime, forcePreview);
  }
}

async function executeNewTweets(setting, provider, count, currentTime, forcePreview = false) {
  const sb = getDb();
  const accountId = setting.account_id;
  const themes = (setting.themes || '').split(',').map(t => t.trim()).filter(Boolean);

  if (themes.length === 0) {
    console.log('AutoPoster: no themes configured for new tweets, skipping');
    await logAutoPostExecution(accountId, 'new', 0, 0, 0, 'failed', 'テーマが設定されていません');
    return { generated: 0, drafts: 0, scheduled: 0, posted: 0 };
  }

  let generated = 0;
  let scheduled = 0;
  let posted = 0;
  let drafts = 0;

  for (let i = 0; i < count; i++) {
    try {
      // Pick a theme (cycle through available themes)
      const theme = themes[i % themes.length];

      // Include competitor context for better content
      let competitorContext = '';
      try {
        competitorContext = await getCompetitorContext(accountId);
      } catch (e) {
        // Non-critical
      }

      const result = await provider.generateTweets(theme, {
        postType: 'new',
        accountId,
        includeCompetitorContext: true,
        competitorContext
      });

      if (!result.candidates || result.candidates.length === 0) continue;

      // Use the first candidate
      const candidate = result.candidates[0];
      generated++;

      if (forcePreview) {
        // Save as draft for user review
        await sb.from('my_posts').insert({
          account_id: accountId,
          text: candidate.text,
          post_type: 'new',
          status: 'draft',
          ai_provider: result.provider,
          ai_model: result.model
        });
        drafts++;
      } else if (setting.schedule_mode === 'immediate') {
        // Post immediately
        const xResult = await postTweet(candidate.text, { accountId });
        await sb.from('my_posts').insert({
          account_id: accountId,
          tweet_id: xResult.data.id,
          text: candidate.text,
          post_type: 'new',
          status: 'posted',
          posted_at: new Date().toISOString(),
          ai_provider: result.provider,
          ai_model: result.model
        });
        posted++;
      } else {
        // Schedule for later - spread posts evenly through remaining hours
        const scheduledAt = calculateScheduleTime(i, count, currentTime);
        await sb.from('my_posts').insert({
          account_id: accountId,
          text: candidate.text,
          post_type: 'new',
          status: 'scheduled',
          scheduled_at: scheduledAt.toISOString(),
          ai_provider: result.provider,
          ai_model: result.model
        });
        scheduled++;
      }
    } catch (err) {
      console.error(`AutoPoster: failed to generate/post new tweet ${i + 1}:`, err.message);
    }
  }

  const status = generated === count ? 'success' : (generated > 0 ? 'partial' : 'failed');
  await logAutoPostExecution(accountId, 'new', generated, scheduled, posted, status,
    forcePreview ? `下書き${drafts}件作成` : undefined);
  return { generated, drafts, scheduled, posted };
}

async function executeReplies(setting, provider, count, currentTime, forcePreview = false) {
  const sb = getDb();
  const accountId = setting.account_id;

  // Get reply target suggestions from competitor tweets
  const suggestions = await getReplySuggestions(accountId, { limit: count });
  if (!suggestions || suggestions.length === 0) {
    console.log('AutoPoster: no reply targets available');
    await logAutoPostExecution(accountId, 'reply', 0, 0, 0, 'failed', 'リプライ対象のツイートが見つかりません');
    return { generated: 0, drafts: 0, scheduled: 0, posted: 0 };
  }

  let generated = 0;
  let scheduled = 0;
  let posted = 0;
  let drafts = 0;
  const total = Math.min(count, suggestions.length);

  for (let i = 0; i < total; i++) {
    try {
      const target = suggestions[i];

      const result = await provider.generateTweets(target.text, {
        postType: 'reply',
        accountId,
        customPrompt: `以下のツイートへのリプライを3パターン作成してください。\n\n元ツイート (@${target.handle}): ${target.text}`
      });

      if (!result.candidates || result.candidates.length === 0) continue;

      const candidate = result.candidates[0];
      generated++;

      if (forcePreview) {
        await sb.from('my_posts').insert({
          account_id: accountId,
          text: candidate.text,
          post_type: 'reply',
          target_tweet_id: target.tweet_id,
          status: 'draft',
          ai_provider: result.provider,
          ai_model: result.model
        });
        drafts++;
      } else if (setting.schedule_mode === 'immediate') {
        const xResult = await postTweet(candidate.text, {
          accountId,
          replyToId: target.tweet_id
        });
        await sb.from('my_posts').insert({
          account_id: accountId,
          tweet_id: xResult.data.id,
          text: candidate.text,
          post_type: 'reply',
          target_tweet_id: target.tweet_id,
          status: 'posted',
          posted_at: new Date().toISOString(),
          ai_provider: result.provider,
          ai_model: result.model
        });
        posted++;
      } else {
        const scheduledAt = calculateScheduleTime(i, count, currentTime);
        await sb.from('my_posts').insert({
          account_id: accountId,
          text: candidate.text,
          post_type: 'reply',
          target_tweet_id: target.tweet_id,
          status: 'scheduled',
          scheduled_at: scheduledAt.toISOString(),
          ai_provider: result.provider,
          ai_model: result.model
        });
        scheduled++;
      }
    } catch (err) {
      console.error(`AutoPoster: failed to generate/post reply ${i + 1}:`, err.message);
    }
  }

  const status = generated === total ? 'success' : (generated > 0 ? 'partial' : 'failed');
  await logAutoPostExecution(accountId, 'reply', generated, scheduled, posted, status,
    forcePreview ? `下書き${drafts}件作成` : undefined);
  return { generated, drafts, scheduled, posted };
}

async function executeQuotes(setting, provider, count, currentTime, forcePreview = false) {
  const sb = getDb();
  const accountId = setting.account_id;

  // Get quote target suggestions from competitor tweets
  const suggestions = await getQuoteSuggestions(accountId, { limit: count });
  if (!suggestions || suggestions.length === 0) {
    console.log('AutoPoster: no quote targets available');
    await logAutoPostExecution(accountId, 'quote', 0, 0, 0, 'failed', '引用RT対象のツイートが見つかりません');
    return { generated: 0, drafts: 0, scheduled: 0, posted: 0 };
  }

  let generated = 0;
  let scheduled = 0;
  let posted = 0;
  let drafts = 0;
  const total = Math.min(count, suggestions.length);

  for (let i = 0; i < total; i++) {
    try {
      const target = suggestions[i];

      const result = await provider.generateTweets(target.text, {
        postType: 'quote',
        accountId,
        customPrompt: `以下のツイートへの引用リツイートを3パターン作成してください。\n\n元ツイート (@${target.handle}): ${target.text}`
      });

      if (!result.candidates || result.candidates.length === 0) continue;

      const candidate = result.candidates[0];
      generated++;

      if (forcePreview) {
        await sb.from('my_posts').insert({
          account_id: accountId,
          text: candidate.text,
          post_type: 'quote',
          target_tweet_id: target.tweet_id,
          status: 'draft',
          ai_provider: result.provider,
          ai_model: result.model
        });
        drafts++;
      } else if (setting.schedule_mode === 'immediate') {
        const xResult = await postTweet(candidate.text, {
          accountId,
          quoteTweetId: target.tweet_id
        });
        await sb.from('my_posts').insert({
          account_id: accountId,
          tweet_id: xResult.data.id,
          text: candidate.text,
          post_type: 'quote',
          target_tweet_id: target.tweet_id,
          status: 'posted',
          posted_at: new Date().toISOString(),
          ai_provider: result.provider,
          ai_model: result.model
        });
        posted++;
      } else {
        const scheduledAt = calculateScheduleTime(i, count, currentTime);
        await sb.from('my_posts').insert({
          account_id: accountId,
          text: candidate.text,
          post_type: 'quote',
          target_tweet_id: target.tweet_id,
          status: 'scheduled',
          scheduled_at: scheduledAt.toISOString(),
          ai_provider: result.provider,
          ai_model: result.model
        });
        scheduled++;
      }
    } catch (err) {
      console.error(`AutoPoster: failed to generate/post quote ${i + 1}:`, err.message);
    }
  }

  const status = generated === total ? 'success' : (generated > 0 ? 'partial' : 'failed');
  await logAutoPostExecution(accountId, 'quote', generated, scheduled, posted, status,
    forcePreview ? `下書き${drafts}件作成` : undefined);
  return { generated, drafts, scheduled, posted };
}

/**
 * Calculate a scheduled time for a post, spread evenly through remaining day hours.
 * If run at 09:00 with 3 posts, schedules at roughly 10:00, 14:00, 18:00.
 */
function calculateScheduleTime(index, totalCount, currentTime) {
  const now = new Date();
  const [currentHour, currentMin] = currentTime.split(':').map(Number);

  // Spread posts from 1 hour after current time until 21:00
  const startHour = currentHour + 1;
  const endHour = 21;
  const availableHours = Math.max(endHour - startHour, 1);
  const interval = availableHours / totalCount;

  const targetHour = Math.min(startHour + Math.round(interval * index), endHour);
  const targetMin = Math.floor(Math.random() * 15); // Add 0-14 min randomness

  const scheduled = new Date(now);
  scheduled.setHours(targetHour, targetMin, 0, 0);

  // If the calculated time is in the past (edge case), set it to now + 5 min
  if (scheduled <= now) {
    scheduled.setTime(now.getTime() + 5 * 60 * 1000);
  }

  return scheduled;
}

async function logAutoPostExecution(accountId, postType, generated, scheduled, posted, status, errorMessage) {
  try {
    const sb = getDb();
    await sb.from('auto_post_logs').insert({
      account_id: accountId,
      post_type: postType,
      posts_generated: generated,
      posts_scheduled: scheduled,
      posts_posted: posted,
      status,
      error_message: errorMessage || null
    });
  } catch (err) {
    console.error('AutoPoster: failed to log execution:', err.message);
  }
}

/**
 * Manually trigger auto-post for a specific setting (for testing/manual runs)
 */
async function runAutoPostManually(settingId) {
  const sb = getDb();
  const { data: setting, error } = await sb.from('auto_post_settings')
    .select('*, x_accounts(display_name, handle, default_ai_provider, default_ai_model)')
    .eq('id', settingId)
    .single();

  if (error || !setting) {
    throw new Error('設定が見つかりません');
  }

  const now = new Date();
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // Always create as drafts for manual runs so user can preview before posting
  const result = await executeAutoPost(setting, setting.posts_per_day, currentTime, { forcePreview: true });
  return {
    success: true,
    postType: setting.post_type,
    count: setting.posts_per_day,
    drafts: result?.drafts || 0,
    generated: result?.generated || 0,
  };
}

module.exports = {
  checkAndRunAutoPosts,
  runAutoPostManually,
  logAutoPostExecution
};
