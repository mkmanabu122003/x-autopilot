const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = process.env.DATABASE_URL || path.join(__dirname, 'autopilot.sqlite');

let db;

function getDb() {
  if (!db) {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDatabase() {
  const database = getDb();

  database.exec(`
    CREATE TABLE IF NOT EXISTS x_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS competitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      handle TEXT NOT NULL,
      name TEXT,
      user_id TEXT NOT NULL,
      followers_count INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES x_accounts(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS competitor_tweets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      competitor_id INTEGER NOT NULL,
      tweet_id TEXT NOT NULL UNIQUE,
      text TEXT,
      created_at_x DATETIME,
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
      fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (competitor_id) REFERENCES competitors(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS my_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      tweet_id TEXT,
      text TEXT NOT NULL,
      post_type TEXT NOT NULL CHECK(post_type IN ('new', 'reply', 'quote')),
      target_tweet_id TEXT,
      status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'scheduled', 'posted', 'failed')),
      scheduled_at DATETIME,
      posted_at DATETIME,
      ai_provider TEXT,
      ai_model TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES x_accounts(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS api_usage_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER,
      api_type TEXT NOT NULL,
      endpoint TEXT,
      cost_usd REAL DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES x_accounts(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_competitor_tweets_competitor_id ON competitor_tweets(competitor_id);
    CREATE INDEX IF NOT EXISTS idx_competitor_tweets_engagement_rate ON competitor_tweets(engagement_rate DESC);
    CREATE INDEX IF NOT EXISTS idx_competitor_tweets_created_at_x ON competitor_tweets(created_at_x);
    CREATE INDEX IF NOT EXISTS idx_my_posts_status ON my_posts(status);
    CREATE INDEX IF NOT EXISTS idx_my_posts_scheduled_at ON my_posts(scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_my_posts_account_id ON my_posts(account_id);
    CREATE INDEX IF NOT EXISTS idx_api_usage_log_created_at ON api_usage_log(created_at);
    CREATE INDEX IF NOT EXISTS idx_api_usage_log_api_type ON api_usage_log(api_type);
    CREATE INDEX IF NOT EXISTS idx_competitors_account_id ON competitors(account_id);
  `);

  // Insert default settings if not present
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

  const insertStmt = database.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)'
  );

  const insertDefaults = database.transaction(() => {
    for (const [key, value] of Object.entries(defaults)) {
      insertStmt.run(key, value);
    }
  });
  insertDefaults();

  // Migrate: add account_id columns if missing (for existing databases)
  try {
    database.prepare('SELECT account_id FROM my_posts LIMIT 1').get();
  } catch {
    database.exec('ALTER TABLE my_posts ADD COLUMN account_id INTEGER REFERENCES x_accounts(id) ON DELETE SET NULL');
  }
  try {
    database.prepare('SELECT ai_model FROM my_posts LIMIT 1').get();
  } catch {
    database.exec('ALTER TABLE my_posts ADD COLUMN ai_model TEXT');
  }
  try {
    database.prepare('SELECT account_id FROM competitors LIMIT 1').get();
  } catch {
    database.exec('ALTER TABLE competitors ADD COLUMN account_id INTEGER REFERENCES x_accounts(id) ON DELETE CASCADE');
  }
  try {
    database.prepare('SELECT account_id FROM api_usage_log LIMIT 1').get();
  } catch {
    database.exec('ALTER TABLE api_usage_log ADD COLUMN account_id INTEGER REFERENCES x_accounts(id) ON DELETE SET NULL');
  }

  console.log('Database initialized');
  return database;
}

module.exports = { getDb, initDatabase };
