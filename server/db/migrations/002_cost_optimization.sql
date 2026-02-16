-- API Cost Optimization: New tables for detailed usage tracking and settings

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

CREATE TABLE IF NOT EXISTS task_model_settings (
  id SERIAL PRIMARY KEY,
  task_type TEXT NOT NULL UNIQUE,
  claude_model TEXT NOT NULL,
  gemini_model TEXT NOT NULL,
  effort TEXT DEFAULT 'medium',
  max_tokens INTEGER DEFAULT 512,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custom_prompts (
  id SERIAL PRIMARY KEY,
  task_type TEXT NOT NULL UNIQUE,
  system_prompt TEXT NOT NULL,
  user_template TEXT NOT NULL,
  is_custom BOOLEAN DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

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
