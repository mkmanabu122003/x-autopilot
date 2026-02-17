const { getSupabase } = require('./supabase');

function getDb() {
  return getSupabase();
}

async function ensureTaskModelColumns(sb) {
  // Add preferred_provider column if it doesn't exist
  // Try a simple read to test; if the column exists, this is a no-op
  try {
    const { data, error } = await sb.from('task_model_settings')
      .select('preferred_provider')
      .limit(1);
    if (error && error.message.includes('preferred_provider')) {
      // Column doesn't exist - need to run migration via Supabase SQL editor:
      // ALTER TABLE task_model_settings ADD COLUMN preferred_provider TEXT DEFAULT 'claude';
      console.warn('task_model_settings.preferred_provider column not found. Please run migration:');
      console.warn("  ALTER TABLE task_model_settings ADD COLUMN preferred_provider TEXT DEFAULT 'claude';");
    }
  } catch (err) {
    // Ignore - column check failed
  }
}

async function initDatabase() {
  const sb = getSupabase();

  await ensureTaskModelColumns(sb);

  const defaults = {
    competitor_fetch_interval: process.env.COMPETITOR_FETCH_INTERVAL || 'weekly',
    monthly_budget_usd: process.env.MONTHLY_BUDGET_USD || '33',
    system_prompt: `あなたはXで高いエンゲージメントを獲得するツイートを作成する専門家です。

以下の条件でツイートを3パターン作成してください:
- 280文字以内（日本語の場合は140文字を目安に）
- ハッシュタグは2-3個
- エンゲージメントを高める工夫を含める（問いかけ、共感、驚き、具体的数字など）
- 投稿タイプ: {postType}（新規ツイート / コメント / 引用RT）

テーマ: {userInput}

{competitorContext}`,
    default_hashtags: '',
    confirm_before_post: 'true',
    competitor_max_accounts: '10'
  };

  for (const [key, value] of Object.entries(defaults)) {
    await sb.from('settings').upsert({ key, value }, { onConflict: 'key', ignoreDuplicates: true });
  }

  console.log('Database initialized (Supabase)');
}

module.exports = { getDb, initDatabase };
