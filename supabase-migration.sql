-- Run this in Supabase SQL Editor to create tables

CREATE TABLE IF NOT EXISTS x_accounts (
  id SERIAL PRIMARY KEY,
  display_name TEXT NOT NULL,
  handle TEXT NOT NULL UNIQUE,
  color TEXT NOT NULL DEFAULT '#3B82F6',
  api_key TEXT NOT NULL,
  api_secret TEXT NOT NULL,
  access_token TEXT NOT NULL,
  access_token_secret TEXT NOT NULL,
  bearer_token TEXT NOT NULL DEFAULT '',
  default_ai_provider TEXT NOT NULL DEFAULT 'claude',
  default_ai_model TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS competitors (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES x_accounts(id) ON DELETE CASCADE,
  handle TEXT NOT NULL,
  name TEXT,
  user_id TEXT NOT NULL,
  followers_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS competitor_tweets (
  id SERIAL PRIMARY KEY,
  competitor_id INTEGER NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  tweet_id TEXT NOT NULL UNIQUE,
  text TEXT,
  created_at_x TIMESTAMPTZ,
  like_count INTEGER DEFAULT 0,
  retweet_count INTEGER DEFAULT 0,
  reply_count INTEGER DEFAULT 0,
  impression_count INTEGER DEFAULT 0,
  quote_count INTEGER DEFAULT 0,
  bookmark_count INTEGER DEFAULT 0,
  engagement_rate REAL DEFAULT 0,
  has_media BOOLEAN DEFAULT FALSE,
  has_link BOOLEAN DEFAULT FALSE,
  is_thread BOOLEAN DEFAULT FALSE,
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS my_posts (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES x_accounts(id) ON DELETE SET NULL,
  tweet_id TEXT,
  text TEXT NOT NULL,
  post_type TEXT NOT NULL CHECK(post_type IN ('new', 'reply', 'quote')),
  target_tweet_id TEXT,
  status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'scheduled', 'posted', 'failed')),
  scheduled_at TIMESTAMPTZ,
  posted_at TIMESTAMPTZ,
  ai_provider TEXT,
  ai_model TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS api_usage_log (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES x_accounts(id) ON DELETE SET NULL,
  api_type TEXT NOT NULL,
  endpoint TEXT,
  cost_usd REAL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_competitor_tweets_competitor_id ON competitor_tweets(competitor_id);
CREATE INDEX IF NOT EXISTS idx_competitor_tweets_engagement_rate ON competitor_tweets(engagement_rate DESC);
CREATE INDEX IF NOT EXISTS idx_competitor_tweets_created_at_x ON competitor_tweets(created_at_x);
CREATE INDEX IF NOT EXISTS idx_my_posts_status ON my_posts(status);
CREATE INDEX IF NOT EXISTS idx_my_posts_scheduled_at ON my_posts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_my_posts_account_id ON my_posts(account_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_log_created_at ON api_usage_log(created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_log_api_type ON api_usage_log(api_type);
CREATE INDEX IF NOT EXISTS idx_competitors_account_id ON competitors(account_id);

-- Default settings
INSERT INTO settings (key, value) VALUES
  ('competitor_fetch_interval', 'weekly'),
  ('monthly_budget_usd', '33'),
  ('system_prompt', 'あなたはXで高いエンゲージメントを獲得するツイートを作成する専門家です。

以下の条件でツイートを3パターン作成してください:
- 280文字以内（日本語の場合は140文字を目安に）
- ハッシュタグは2-3個
- エンゲージメントを高める工夫を含める（問いかけ、共感、驚き、具体的数字など）
- 投稿タイプ: {postType}（新規ツイート / コメント / 引用RT）

テーマ: {userInput}

{competitorContext}'),
  ('default_hashtags', ''),
  ('confirm_before_post', 'true'),
  ('competitor_max_accounts', '10')
ON CONFLICT (key) DO NOTHING;
