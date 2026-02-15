const { getSupabase } = require('./supabase');

function getDb() {
  return getSupabase();
}

async function initDatabase() {
  const sb = getSupabase();

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
