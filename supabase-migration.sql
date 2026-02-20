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
CREATE UNIQUE INDEX IF NOT EXISTS idx_competitors_account_handle ON competitors(account_id, handle);

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
  ('competitor_max_accounts', '10'),
  ('budget_x_api_usd', '10'),
  ('budget_gemini_usd', '10'),
  ('budget_claude_usd', '13')
ON CONFLICT (key) DO NOTHING;

-- ============================================
-- API Cost Optimization Tables (Phase 5b-5f)
-- ============================================

-- Detailed API usage logs with token-level tracking
CREATE TABLE IF NOT EXISTS api_usage_logs (
  id SERIAL PRIMARY KEY,
  timestamp TIMESTAMPTZ DEFAULT NOW(),
  provider TEXT NOT NULL,
  model TEXT,
  task_type TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  thinking_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  is_batch BOOLEAN DEFAULT FALSE,
  estimated_cost_usd REAL NOT NULL,
  request_id TEXT,
  batch_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_usage_logs_timestamp ON api_usage_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_usage_logs_provider ON api_usage_logs(provider);
CREATE INDEX IF NOT EXISTS idx_usage_logs_task ON api_usage_logs(task_type);

-- Cost optimization settings
CREATE TABLE IF NOT EXISTS cost_settings (
  id SERIAL PRIMARY KEY,
  monthly_budget_usd REAL DEFAULT 33.0,
  budget_alert_80 BOOLEAN DEFAULT TRUE,
  budget_pause_100 BOOLEAN DEFAULT TRUE,
  batch_enabled BOOLEAN DEFAULT TRUE,
  cache_enabled BOOLEAN DEFAULT TRUE,
  batch_schedule_hour INTEGER DEFAULT 3,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Task-specific AI model settings
CREATE TABLE IF NOT EXISTS task_model_settings (
  id SERIAL PRIMARY KEY,
  task_type TEXT NOT NULL UNIQUE,
  preferred_provider TEXT DEFAULT 'claude',
  claude_model TEXT NOT NULL,
  gemini_model TEXT NOT NULL,
  effort TEXT DEFAULT 'medium',
  max_tokens INTEGER DEFAULT 512,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add preferred_provider column if not exists (for existing installations)
DO $$ BEGIN
  ALTER TABLE task_model_settings ADD COLUMN IF NOT EXISTS preferred_provider TEXT DEFAULT 'claude';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Custom prompt templates per task type
CREATE TABLE IF NOT EXISTS custom_prompts (
  id SERIAL PRIMARY KEY,
  task_type TEXT NOT NULL UNIQUE,
  system_prompt TEXT NOT NULL,
  user_template TEXT NOT NULL,
  is_custom BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Batch API job tracking
CREATE TABLE IF NOT EXISTS batch_jobs (
  id SERIAL PRIMARY KEY,
  batch_id TEXT NOT NULL UNIQUE,
  status TEXT DEFAULT 'processing',
  task_type TEXT NOT NULL,
  request_count INTEGER DEFAULT 0,
  completed_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  results JSONB
);

CREATE INDEX IF NOT EXISTS idx_batch_jobs_status ON batch_jobs(status);

-- Default cost settings
INSERT INTO cost_settings (monthly_budget_usd, budget_alert_80, budget_pause_100, batch_enabled, cache_enabled, batch_schedule_hour)
VALUES (33.0, TRUE, TRUE, TRUE, TRUE, 3)
ON CONFLICT DO NOTHING;

-- Default task model settings
INSERT INTO task_model_settings (task_type, claude_model, gemini_model, effort, max_tokens) VALUES
  ('competitor_analysis', 'claude-opus-4-6', 'gemini-2.5-pro', 'high', 2048),
  ('tweet_generation', 'claude-sonnet-4-5-20250929', 'gemini-2.5-flash', 'medium', 512),
  ('comment_generation', 'claude-haiku-4-5-20251001', 'gemini-2.0-flash', 'low', 256),
  ('quote_rt_generation', 'claude-haiku-4-5-20251001', 'gemini-2.0-flash', 'low', 256),
  ('performance_summary', 'claude-haiku-4-5-20251001', 'gemini-2.0-flash', 'low', 1024)
ON CONFLICT (task_type) DO NOTHING;

-- ============================================
-- Growth & Monetization Dashboard (Phase 6)
-- ============================================

-- Add engagement metrics columns to my_posts for own post tracking
ALTER TABLE my_posts ADD COLUMN IF NOT EXISTS like_count INTEGER DEFAULT 0;
ALTER TABLE my_posts ADD COLUMN IF NOT EXISTS retweet_count INTEGER DEFAULT 0;
ALTER TABLE my_posts ADD COLUMN IF NOT EXISTS reply_count INTEGER DEFAULT 0;
ALTER TABLE my_posts ADD COLUMN IF NOT EXISTS impression_count INTEGER DEFAULT 0;
ALTER TABLE my_posts ADD COLUMN IF NOT EXISTS quote_count INTEGER DEFAULT 0;
ALTER TABLE my_posts ADD COLUMN IF NOT EXISTS bookmark_count INTEGER DEFAULT 0;
ALTER TABLE my_posts ADD COLUMN IF NOT EXISTS engagement_rate REAL DEFAULT 0;
ALTER TABLE my_posts ADD COLUMN IF NOT EXISTS metrics_updated_at TIMESTAMPTZ;

-- Follower snapshot tracking table
CREATE TABLE IF NOT EXISTS follower_snapshots (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES x_accounts(id) ON DELETE CASCADE,
  follower_count INTEGER NOT NULL DEFAULT 0,
  following_count INTEGER NOT NULL DEFAULT 0,
  tweet_count INTEGER NOT NULL DEFAULT 0,
  listed_count INTEGER NOT NULL DEFAULT 0,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_follower_snapshots_account ON follower_snapshots(account_id);
CREATE INDEX IF NOT EXISTS idx_follower_snapshots_recorded ON follower_snapshots(recorded_at);
CREATE INDEX IF NOT EXISTS idx_my_posts_posted_at ON my_posts(posted_at);
CREATE INDEX IF NOT EXISTS idx_my_posts_engagement_rate ON my_posts(engagement_rate DESC);

-- ============================================
-- Auto Post Settings (Scheduled Batch Posting)
-- ============================================

-- Per-account, per-post-type auto posting configuration
CREATE TABLE IF NOT EXISTS auto_post_settings (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES x_accounts(id) ON DELETE CASCADE,
  post_type TEXT NOT NULL CHECK(post_type IN ('new', 'reply', 'quote')),
  enabled BOOLEAN DEFAULT FALSE,
  posts_per_day INTEGER DEFAULT 1,
  schedule_times TEXT NOT NULL DEFAULT '09:00',
  schedule_mode TEXT DEFAULT 'scheduled' CHECK(schedule_mode IN ('scheduled', 'immediate', 'draft')),
  themes TEXT DEFAULT '',
  tone TEXT DEFAULT '',
  target_audience TEXT DEFAULT '',
  style_note TEXT DEFAULT '',
  ai_model TEXT DEFAULT '',
  max_length INTEGER DEFAULT 0,
  last_run_date TEXT,
  last_run_times TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(account_id, post_type)
);

CREATE INDEX IF NOT EXISTS idx_auto_post_settings_account ON auto_post_settings(account_id);
CREATE INDEX IF NOT EXISTS idx_auto_post_settings_enabled ON auto_post_settings(enabled);

-- Auto post execution log for tracking and debugging
CREATE TABLE IF NOT EXISTS auto_post_logs (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES x_accounts(id) ON DELETE SET NULL,
  post_type TEXT NOT NULL,
  posts_generated INTEGER DEFAULT 0,
  posts_scheduled INTEGER DEFAULT 0,
  posts_posted INTEGER DEFAULT 0,
  status TEXT DEFAULT 'success' CHECK(status IN ('success', 'partial', 'failed')),
  error_message TEXT,
  executed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auto_post_logs_executed ON auto_post_logs(executed_at);
CREATE INDEX IF NOT EXISTS idx_auto_post_logs_account ON auto_post_logs(account_id);

-- ============================================
-- Scheduled Post Error Tracking
-- ============================================
ALTER TABLE my_posts ADD COLUMN IF NOT EXISTS error_message TEXT;

-- ============================================
-- Application Logs (Error Investigation)
-- ============================================

CREATE TABLE IF NOT EXISTS app_logs (
  id SERIAL PRIMARY KEY,
  level TEXT NOT NULL DEFAULT 'info' CHECK(level IN ('error', 'warn', 'info')),
  category TEXT NOT NULL DEFAULT 'system',
  message TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_logs_created_at ON app_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_app_logs_level ON app_logs(level);
CREATE INDEX IF NOT EXISTS idx_app_logs_category ON app_logs(category);

-- ============================================
-- Auto Post Style Settings (tone, target, style note)
-- ============================================
ALTER TABLE auto_post_settings ADD COLUMN IF NOT EXISTS tone TEXT DEFAULT '';
ALTER TABLE auto_post_settings ADD COLUMN IF NOT EXISTS target_audience TEXT DEFAULT '';
ALTER TABLE auto_post_settings ADD COLUMN IF NOT EXISTS style_note TEXT DEFAULT '';
ALTER TABLE auto_post_settings ADD COLUMN IF NOT EXISTS ai_model TEXT DEFAULT '';
ALTER TABLE auto_post_settings ADD COLUMN IF NOT EXISTS max_length INTEGER DEFAULT 0;

-- ============================================
-- Add 'draft' to schedule_mode options
-- ============================================
-- Drop old constraint and re-create with 'draft' option
ALTER TABLE auto_post_settings DROP CONSTRAINT IF EXISTS auto_post_settings_schedule_mode_check;
ALTER TABLE auto_post_settings ADD CONSTRAINT auto_post_settings_schedule_mode_check
  CHECK(schedule_mode IN ('scheduled', 'immediate', 'draft'));

-- ============================================
-- Theme Categories for diverse content generation
-- ============================================
CREATE TABLE IF NOT EXISTS theme_categories (
  id SERIAL PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES x_accounts(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_theme_categories_account_code
  ON theme_categories(account_id, code);
CREATE INDEX IF NOT EXISTS idx_theme_categories_account
  ON theme_categories(account_id);

-- Track which theme category was used for each generated post
ALTER TABLE my_posts ADD COLUMN IF NOT EXISTS theme_category TEXT;

-- ============================================
-- Tweet Pattern Log for structural pattern rotation
-- ============================================
CREATE TABLE IF NOT EXISTS tweet_pattern_log (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES x_accounts(id) ON DELETE CASCADE,
  opening_pattern TEXT,
  development_pattern TEXT,
  closing_pattern TEXT,
  expressions JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tweet_pattern_log_account
  ON tweet_pattern_log(account_id);
CREATE INDEX IF NOT EXISTS idx_tweet_pattern_log_created
  ON tweet_pattern_log(created_at);

-- ============================================
-- Tweet Improvement Analysis (Auto-improvement feedback loop)
-- ============================================

-- Stores periodic performance analysis results and AI-generated improvement suggestions
CREATE TABLE IF NOT EXISTS improvement_analyses (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES x_accounts(id) ON DELETE CASCADE,
  post_count INTEGER NOT NULL DEFAULT 0,
  avg_engagement_rate REAL DEFAULT 0,
  avg_impressions INTEGER DEFAULT 0,
  top_posts JSONB DEFAULT '[]',
  bottom_posts JSONB DEFAULT '[]',
  category_analysis JSONB DEFAULT '[]',
  time_analysis JSONB DEFAULT '{}',
  text_analysis JSONB DEFAULT '{}',
  suggestions JSONB DEFAULT '[]',
  adjustments_applied JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_improvement_analyses_account
  ON improvement_analyses(account_id);
CREATE INDEX IF NOT EXISTS idx_improvement_analyses_created
  ON improvement_analyses(created_at);
