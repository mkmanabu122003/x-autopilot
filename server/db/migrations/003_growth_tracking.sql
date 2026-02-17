-- Growth & Monetization Dashboard: Add own post metrics and follower tracking

-- Add engagement metrics columns to my_posts
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

-- Index for own post metrics queries
CREATE INDEX IF NOT EXISTS idx_my_posts_posted_at ON my_posts(posted_at);
CREATE INDEX IF NOT EXISTS idx_my_posts_engagement_rate ON my_posts(engagement_rate DESC);
