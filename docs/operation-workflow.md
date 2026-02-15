# X AutoPilot 運用フロー

## 全体アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                      Client (React)                         │
│  Dashboard │ Post │ Competitors │ Settings                  │
└─────┬───────────────────────────────────────────────────────┘
      │ HTTP (REST API)
┌─────▼───────────────────────────────────────────────────────┐
│                    Server (Express.js)                       │
│  Routes:  /api/tweets  /api/ai  /api/competitors            │
│           /api/analytics  /api/settings                     │
├─────────────────────────────────────────────────────────────┤
│  Services:                                                  │
│  ┌──────────┐ ┌──────────────┐ ┌───────────┐ ┌───────────┐ │
│  │ x-api.js │ │ai-provider.js│ │scheduler.js│ │analytics.js│ │
│  └────┬─────┘ └──────┬───────┘ └─────┬─────┘ └─────┬─────┘ │
├───────┼──────────────┼───────────────┼───────────────┼──────┤
│       │              │               │               │      │
│  ┌────▼──────────────▼───────────────▼───────────────▼────┐ │
│  │                  SQLite (database.js)                   │ │
│  │  competitors │ competitor_tweets │ my_posts             │ │
│  │  settings    │ api_usage_log                            │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
      │                │
      ▼                ▼
  X (Twitter) API   Claude / Gemini API
```

---

## 1. 初期セットアップ

### 1.1 環境変数の設定

`.env.example` を `.env` にコピーし、以下のAPIキーを設定する。

| カテゴリ | 環境変数 | 用途 |
|---------|---------|------|
| X API | `X_API_KEY`, `X_API_SECRET` | OAuth 1.0a 認証（投稿用） |
| X API | `X_ACCESS_TOKEN`, `X_ACCESS_TOKEN_SECRET` | ユーザーアクセストークン |
| X API | `X_BEARER_TOKEN` | 読み取り用 Bearer Token |
| AI | `CLAUDE_API_KEY` | Claude API（ツイート生成） |
| AI | `GEMINI_API_KEY` | Gemini API（ツイート生成） |
| アプリ | `PORT` | サーバーポート（デフォルト: 3001） |
| アプリ | `DATABASE_URL` | SQLite ファイルパス |

### 1.2 起動手順

```bash
# 依存関係のインストール
npm install
cd client && npm install && cd ..

# 開発モード（サーバー + クライアント同時起動）
npm run dev

# 本番モード
npm run client:build
npm start
```

### 1.3 デフォルト設定値

サーバー起動時に `settings` テーブルへ以下のデフォルト値が自動挿入される。

| キー | デフォルト値 | 説明 |
|------|-------------|------|
| `default_ai_provider` | `claude` | AI プロバイダー |
| `claude_model` | `claude-sonnet-4-20250514` | Claude モデル |
| `gemini_model` | `gemini-2.0-flash` | Gemini モデル |
| `competitor_fetch_interval` | `weekly` | 競合取得間隔 |
| `monthly_budget_usd` | `33` | 月間API予算（USD） |
| `competitor_max_accounts` | `10` | 競合登録上限 |
| `confirm_before_post` | `true` | 投稿前確認 |

---

## 2. 日常運用フロー

### 2.1 ツイート作成・投稿フロー

```
┌─────────┐    ┌──────────────┐    ┌─────────────┐    ┌──────────┐
│テーマ入力 │───▶│ AI候補生成    │───▶│ 候補選択・編集│───▶│ 即時投稿  │
│(Post画面)│    │(3パターン)    │    │              │    │ or 予約  │
└─────────┘    └──────────────┘    └─────────────┘    └──────────┘
                     │                                      │
                     ▼                                      ▼
              ┌──────────────┐                    ┌──────────────┐
              │ 競合コンテキスト│                    │  X API 投稿   │
              │ 自動付与(任意) │                    │              │
              └──────────────┘                    └──────────────┘
```

**詳細ステップ:**

1. **テーマ入力**: Post 画面でツイートのテーマを入力
2. **AIプロバイダー選択**: Claude または Gemini を選択（Settings で切替可能）
3. **競合コンテキスト付与（オプション）**: 競合のエンゲージメントデータをAIプロンプトに含める
4. **AI候補生成**: `POST /api/ai/generate` → 3パターンのツイート候補を生成
5. **候補選択・編集**: 生成された候補からベースを選び、必要に応じて編集
6. **投稿方法の選択**:
   - **即時投稿**: `POST /api/tweets` → X API で即座にツイート
   - **予約投稿**: `POST /api/tweets/schedule` → DB に保存、スケジューラーが投稿時刻に自動投稿

### 2.2 投稿タイプ

| タイプ | エンドポイント | 説明 |
|--------|--------------|------|
| 新規ツイート | `POST /api/tweets` | 通常のツイート |
| リプライ | `POST /api/tweets/reply` | 既存ツイートへの返信（`targetTweetId` 必須） |
| 引用RT | `POST /api/tweets/quote` | 既存ツイートの引用リツイート（`targetTweetId` 必須） |

### 2.3 予約投稿の管理

| 操作 | エンドポイント | 説明 |
|------|--------------|------|
| 一覧取得 | `GET /api/tweets/scheduled` | 予約済み投稿の一覧 |
| 編集 | `PUT /api/tweets/scheduled/:id` | テキスト・日時の変更 |
| キャンセル | `DELETE /api/tweets/scheduled/:id` | 予約の取り消し |

---

## 3. 自動処理（スケジューラー）

サーバー起動時に `node-cron` で以下の自動処理が開始される。

### 3.1 予約投稿の自動実行

```
実行間隔: 毎分（* * * * *）

処理フロー:
1. my_posts テーブルから status='scheduled' かつ scheduled_at <= 現在時刻 のレコードを取得
2. 各レコードに対して X API で投稿を実行
3. 成功 → status を 'posted' に更新、tweet_id を記録
4. 失敗 → status を 'failed' に更新、エラーログ出力
```

### 3.2 競合ツイートの自動取得

```
実行時刻: 毎日 AM 3:00（0 3 * * *）

処理フロー:
1. settings から competitor_fetch_interval を確認
2. 取得条件の判定:
   - daily: 毎日実行
   - weekly: 月曜日のみ実行
   - biweekly: 隔週月曜日のみ実行
3. 条件を満たす場合、全競合アカウントのツイートを取得
4. X API でツイートとエンゲージメント指標を取得
5. engagement_rate を計算して competitor_tweets テーブルに保存
```

**エンゲージメント率の計算式:**

```
engagement_rate = (likes + retweets + replies + quotes) / impressions × 100
```

---

## 4. 競合分析フロー

```
┌────────────┐    ┌──────────────┐    ┌─────────────────┐
│ 競合登録    │───▶│ ツイート取得   │───▶│ エンゲージメント  │
│(@handle)   │    │(自動/手動)    │    │ 分析・可視化     │
└────────────┘    └──────────────┘    └─────────────────┘
      │                                       │
      │                                       ▼
      │                               ┌─────────────────┐
      │                               │ AI生成の       │
      │                               │ コンテキストに活用│
      └──────────────────────────────▶└─────────────────┘
```

### 4.1 競合アカウントの登録

1. Competitors 画面で X のハンドル名を入力
2. `POST /api/competitors` → X API でユーザー情報を検索・登録
3. 上限: `competitor_max_accounts`（デフォルト10件）まで

### 4.2 競合ツイートの取得方法

| 方法 | トリガー | 説明 |
|------|---------|------|
| 自動取得 | Scheduler（AM 3:00） | `competitor_fetch_interval` 設定に従い自動実行 |
| 手動取得 | `POST /api/competitors/fetch` | Competitors 画面から即座にフェッチ |

### 4.3 分析データの活用

取得した競合データは以下の形で活用される:

- **ダッシュボード表示**: 平均エンゲージメント率、トップ投稿
- **時間帯分析**: 高エンゲージメントの投稿時間帯を特定
- **投稿タイプ別分析**: media / link / thread / text 別のパフォーマンス比較
- **AI生成のコンテキスト**: 競合の傾向をAIプロンプトに注入し、より効果的なツイートを生成

---

## 5. 分析・ダッシュボードフロー

### 5.1 ダッシュボード指標

| 指標 | API | 説明 |
|------|-----|------|
| 今月の投稿数 | `GET /api/analytics/dashboard` | status='posted' の今月の件数 |
| 平均エンゲージメント率 | 同上 | 競合ツイートの今月の平均 ER |
| 合計インプレッション | 同上 | 競合ツイートの今月の合計 |
| API利用コスト | 同上 | 今月の API 利用料 vs 月間予算 |

### 5.2 詳細分析 API

| 分析 | API | 説明 |
|------|-----|------|
| トップ投稿 | `GET /api/analytics/top-posts` | ER 上位の競合ツイート |
| 時間帯パフォーマンス | `GET /api/analytics/hourly` | 時間帯別の平均 ER |
| 週次トレンド | `GET /api/analytics/weekly` | 週単位のエンゲージメント推移 |
| 投稿タイプ別 | `GET /api/analytics/post-types` | media/link/thread/text 別 ER |

---

## 6. API利用量・予算管理

### 6.1 コスト記録の仕組み

全 API 呼び出しは `api_usage_log` テーブルに自動記録される。

| API種別 | エンドポイント | 単価（USD） |
|---------|--------------|------------|
| `x_write` | `POST /2/tweets` | $0.01 |
| `x_user` | `GET /2/users/by/username` | $0.01 |
| `x_read` | `GET /2/users/:id/tweets` | $0.005 × ツイート数 |
| `claude` | `POST /v1/messages` | $0.001 |
| `gemini` | `POST /models/:model:generateContent` | $0.0002 |

### 6.2 予算モニタリング

```
GET /api/settings/usage

レスポンス:
- totalCostUsd: 今月の合計コスト
- budgetUsd: 月間予算（デフォルト $33）
- budgetUsedPercent: 予算消化率（%）
- byType: API種別ごとの利用回数・コスト
- daily: 日別コスト推移
```

---

## 7. データフロー全体図

```
[ユーザー操作]
     │
     ├── テーマ入力 ──▶ AI API (Claude/Gemini) ──▶ 候補3件生成
     │                         │
     │                    api_usage_log に記録
     │
     ├── 投稿実行 ──▶ X API (POST /2/tweets) ──▶ my_posts に記録
     │                         │
     │                    api_usage_log に記録
     │
     ├── 予約投稿 ──▶ my_posts (status=scheduled)
     │                    │
     │                    ▼ [Scheduler: 毎分]
     │               X API 投稿 → status=posted/failed
     │
     ├── 競合登録 ──▶ X API (ユーザー検索) ──▶ competitors に記録
     │                         │
     │                    api_usage_log に記録
     │
     └── 競合取得 ──▶ X API (ツイート取得) ──▶ competitor_tweets に記録
          (手動/自動)           │               ┌──▶ Dashboard 表示
                          api_usage_log     ├──▶ 分析グラフ
                               に記録        └──▶ AI生成コンテキスト
```

---

## 8. 投稿ステータス遷移

```
         ┌──────────┐
         │  draft   │ （下書き: 現在未使用）
         └────┬─────┘
              │
              ▼
    ┌───────────────────┐
    │    scheduled      │ ← 予約投稿時に設定
    │  (scheduled_at)   │
    └────┬─────────┬────┘
         │         │
    成功 │         │ 失敗
         ▼         ▼
    ┌────────┐ ┌────────┐
    │ posted │ │ failed │
    └────────┘ └────────┘

    ※ 即時投稿: draft/scheduled を経由せず直接 posted として記録
```

---

## 9. 設定変更の影響範囲

| 設定項目 | 影響範囲 |
|---------|---------|
| `default_ai_provider` | AI生成時のデフォルトプロバイダー切替 |
| `claude_model` / `gemini_model` | AI 生成に使用するモデルの変更 |
| `competitor_fetch_interval` | 自動取得の頻度（daily/weekly/biweekly） |
| `monthly_budget_usd` | ダッシュボードの予算消化率の計算基準 |
| `system_prompt` | AI ツイート生成のシステムプロンプト |
| `competitor_max_accounts` | 登録可能な競合アカウント数の上限 |
| `confirm_before_post` | 投稿前の確認ダイアログ表示 |
| `default_hashtags` | デフォルトで付与するハッシュタグ |

---

## 10. デプロイフロー（Vercel）

```
git push
   │
   ▼
Vercel 自動ビルド
   │
   ├── installCommand: npm install && cd client && npm install
   ├── buildCommand: cd client && npm run build
   └── outputDirectory: client/dist
   │
   ▼
┌──────────────────────────────────┐
│ Vercel 環境                      │
│ ┌──────────────────────────────┐ │
│ │ Serverless Function          │ │
│ │ api/index.js → Express app   │ │
│ │ /api/* → サーバーサイド処理     │ │
│ └──────────────────────────────┘ │
│ ┌──────────────────────────────┐ │
│ │ Static Files                 │ │
│ │ client/dist/* → React SPA    │ │
│ │ /* → index.html (SPA)       │ │
│ └──────────────────────────────┘ │
│                                  │
│ 注意: SQLite は /tmp に保存       │
│ （サーバーレス環境のため永続化なし）│
└──────────────────────────────────┘
```

**本番環境の注意点:**
- Vercel のサーバーレス環境では SQLite が `/tmp` に保存されるため、デプロイ間でデータが失われる
- 本格運用には外部 DB（PostgreSQL 等）への移行を検討すること
