-- ============================================
-- Prompt Feedback Rules (Tweet feedback → prompt improvement loop)
-- ============================================

-- Stores user-approved feedback rules that are permanently injected into tweet generation prompts
CREATE TABLE IF NOT EXISTS prompt_feedback_rules (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES x_accounts(id) ON DELETE CASCADE,
  rule_text TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'content' CHECK(category IN ('content', 'tone', 'structure', 'style')),
  source_feedback TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_prompt_feedback_rules_account
  ON prompt_feedback_rules(account_id);
CREATE INDEX IF NOT EXISTS idx_prompt_feedback_rules_enabled
  ON prompt_feedback_rules(account_id, enabled);
