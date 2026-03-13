-- ============================================
-- Enable Row Level Security on all public tables
-- ============================================
-- This application uses SUPABASE_SERVICE_KEY (service_role) which bypasses RLS.
-- Enabling RLS with no anon policies ensures that anonymous/public access is blocked
-- while the server-side service_role key continues to work without restriction.

-- Core tables
ALTER TABLE IF EXISTS x_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS my_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS competitor_tweets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS settings ENABLE ROW LEVEL SECURITY;

-- API & cost tracking
ALTER TABLE IF EXISTS api_usage_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS api_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS cost_settings ENABLE ROW LEVEL SECURITY;

-- Automation
ALTER TABLE IF EXISTS auto_post_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS auto_post_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS batch_jobs ENABLE ROW LEVEL SECURITY;

-- Content & AI
ALTER TABLE IF EXISTS custom_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS task_model_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS tweet_pattern_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS theme_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS prompt_feedback_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS improvement_analyses ENABLE ROW LEVEL SECURITY;

-- Growth & analytics
ALTER TABLE IF EXISTS follower_snapshots ENABLE ROW LEVEL SECURITY;

-- Logging
ALTER TABLE IF EXISTS app_logs ENABLE ROW LEVEL SECURITY;

-- Telegram workflow
ALTER TABLE IF EXISTS telegram_sessions ENABLE ROW LEVEL SECURITY;
