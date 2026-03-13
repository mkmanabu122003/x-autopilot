-- ============================================
-- Telegram Tweet Approval Workflow
-- ============================================

-- Add telegram tracking columns to my_posts
ALTER TABLE my_posts ADD COLUMN IF NOT EXISTS telegram_message_id TEXT;
ALTER TABLE my_posts ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;

-- Telegram sessions for edit flow state management
CREATE TABLE IF NOT EXISTS telegram_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id TEXT NOT NULL,
  post_id INTEGER REFERENCES my_posts(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'awaiting_feedback',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 minutes')
);

CREATE INDEX IF NOT EXISTS idx_telegram_sessions_chat_state
  ON telegram_sessions(chat_id, state);

-- Add 'telegram' as a valid schedule_mode option
-- (auto_post_settings.schedule_mode is TEXT, so no ALTER needed)
