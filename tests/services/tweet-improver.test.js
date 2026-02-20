// Mock database
jest.mock('../../server/db/database', () => {
  const mockChain = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    not: jest.fn().mockReturnThis(),
    gt: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
  return {
    getDb: jest.fn(() => ({
      from: jest.fn(() => mockChain)
    }))
  };
});

// Mock ai-provider
const mockGenerateTweets = jest.fn().mockResolvedValue({
  provider: 'claude',
  model: 'claude-haiku-4-5-20251001',
  candidates: [{ text: '{"suggestions":[{"category":"content","priority":"high","title":"テスト提案","description":"テストの説明","action":"テストアクション"}]}' }]
});
jest.mock('../../server/services/ai-provider', () => ({
  getAIProvider: jest.fn(() => ({
    generateTweets: mockGenerateTweets
  }))
}));

// Mock cost-calculator
jest.mock('../../server/services/cost-calculator', () => ({
  logDetailedUsage: jest.fn().mockResolvedValue(undefined),
  checkBudgetStatus: jest.fn().mockResolvedValue({ shouldPause: false })
}));

// Mock app-logger
jest.mock('../../server/services/app-logger', () => ({
  logInfo: jest.fn(),
  logError: jest.fn(),
  logWarn: jest.fn()
}));

// Mock x-api (required by ai-provider)
jest.mock('../../server/services/x-api', () => ({
  logApiUsage: jest.fn().mockResolvedValue(undefined)
}));

const {
  extractPatterns,
  analyzePostingTimes,
  analyzeCategoryPerformance,
  analyzeTextFeatures,
  parseImprovementSuggestions,
  summarizePost,
  buildAnalysisPrompt,
  analyzePostPerformance,
  generateImprovementInsights,
  buildPerformanceContextBlock,
  MIN_POSTS_FOR_ANALYSIS,
  ANALYSIS_WINDOW_POSTS,
  TOP_PERCENTILE,
  BOTTOM_PERCENTILE
} = require('../../server/services/tweet-improver');

const { getDb } = require('../../server/db/database');
const { getAIProvider } = require('../../server/services/ai-provider');

describe('tweet-improver', () => {
  describe('定数', () => {
    test('MIN_POSTS_FOR_ANALYSIS は 5', () => {
      expect(MIN_POSTS_FOR_ANALYSIS).toBe(5);
    });

    test('ANALYSIS_WINDOW_POSTS は 30', () => {
      expect(ANALYSIS_WINDOW_POSTS).toBe(30);
    });

    test('TOP_PERCENTILE は 0.25', () => {
      expect(TOP_PERCENTILE).toBe(0.25);
    });

    test('BOTTOM_PERCENTILE は 0.25', () => {
      expect(BOTTOM_PERCENTILE).toBe(0.25);
    });
  });

  describe('extractPatterns', () => {
    test('テーマカテゴリの出現回数を正しくカウントする', () => {
      const posts = [
        { theme_category: 'T-A', post_type: 'new' },
        { theme_category: 'T-A', post_type: 'new' },
        { theme_category: 'T-B', post_type: 'new' },
      ];
      const result = extractPatterns(posts);
      expect(result.themes).toEqual([
        { theme: 'T-A', count: 2 },
        { theme: 'T-B', count: 1 }
      ]);
    });

    test('投稿タイプの出現回数を正しくカウントする', () => {
      const posts = [
        { theme_category: 'T-A', post_type: 'new' },
        { theme_category: 'T-B', post_type: 'reply' },
        { theme_category: 'T-C', post_type: 'new' },
      ];
      const result = extractPatterns(posts);
      expect(result.postTypes).toEqual([
        { type: 'new', count: 2 },
        { type: 'reply', count: 1 }
      ]);
    });

    test('テーマカテゴリが null の場合はスキップする', () => {
      const posts = [
        { theme_category: null, post_type: 'new' },
        { theme_category: 'T-A', post_type: 'new' },
      ];
      const result = extractPatterns(posts);
      expect(result.themes).toEqual([{ theme: 'T-A', count: 1 }]);
    });

    test('空の配列では空のパターンを返す', () => {
      const result = extractPatterns([]);
      expect(result.themes).toEqual([]);
      expect(result.postTypes).toEqual([]);
    });
  });

  describe('analyzePostingTimes', () => {
    test('投稿時間のパフォーマンスを正しく集計する', () => {
      const posts = [
        // UTC 0:00 = JST 9:00
        { posted_at: '2026-01-01T00:00:00Z', engagement_rate: 5.0, impression_count: 1000 },
        { posted_at: '2026-01-02T00:30:00Z', engagement_rate: 3.0, impression_count: 800 },
        // UTC 3:00 = JST 12:00
        { posted_at: '2026-01-01T03:00:00Z', engagement_rate: 8.0, impression_count: 2000 },
      ];
      const result = analyzePostingTimes(posts);

      expect(result.hourlyPerformance).toHaveLength(2);
      // JST 12:00 should have higher ER
      expect(result.bestHours[0]).toBe(12);
    });

    test('posted_at が null の場合はスキップする', () => {
      const posts = [
        { posted_at: null, engagement_rate: 5.0, impression_count: 1000 },
        { posted_at: '2026-01-01T00:00:00Z', engagement_rate: 3.0, impression_count: 800 },
      ];
      const result = analyzePostingTimes(posts);
      expect(result.hourlyPerformance).toHaveLength(1);
    });

    test('空の投稿リストでは空の結果を返す', () => {
      const result = analyzePostingTimes([]);
      expect(result.hourlyPerformance).toEqual([]);
      expect(result.bestHours).toEqual([]);
      expect(result.worstHours).toEqual([]);
    });

    test('JST 変換が正しい（UTC 15:00 = JST 0:00）', () => {
      const posts = [
        { posted_at: '2026-01-01T15:00:00Z', engagement_rate: 5.0, impression_count: 1000 },
      ];
      const result = analyzePostingTimes(posts);
      expect(result.hourlyPerformance[0].hour).toBe(0);
    });
  });

  describe('analyzeCategoryPerformance', () => {
    test('カテゴリ別のパフォーマンスを正しく集計する', () => {
      const posts = [
        { theme_category: 'T-A', engagement_rate: 5.0, impression_count: 1000 },
        { theme_category: 'T-A', engagement_rate: 3.0, impression_count: 800 },
        { theme_category: 'T-B', engagement_rate: 8.0, impression_count: 2000 },
      ];
      const result = analyzeCategoryPerformance(posts);

      expect(result).toHaveLength(2);
      // T-B should be first (higher avg ER)
      expect(result[0].category).toBe('T-B');
      expect(result[0].avgEngagementRate).toBe(8.0);
      expect(result[1].category).toBe('T-A');
      expect(result[1].avgEngagementRate).toBe(4.0);
    });

    test('テーマカテゴリが null の場合は uncategorized として集計する', () => {
      const posts = [
        { theme_category: null, engagement_rate: 5.0, impression_count: 1000 },
      ];
      const result = analyzeCategoryPerformance(posts);
      expect(result[0].category).toBe('uncategorized');
    });

    test('降順にソートされる', () => {
      const posts = [
        { theme_category: 'low', engagement_rate: 1.0, impression_count: 100 },
        { theme_category: 'high', engagement_rate: 10.0, impression_count: 5000 },
        { theme_category: 'mid', engagement_rate: 5.0, impression_count: 1000 },
      ];
      const result = analyzeCategoryPerformance(posts);
      expect(result[0].category).toBe('high');
      expect(result[1].category).toBe('mid');
      expect(result[2].category).toBe('low');
    });
  });

  describe('analyzeTextFeatures', () => {
    test('文字数の平均を正しく計算する', () => {
      const topPosts = [
        { text: 'a'.repeat(100) },
        { text: 'b'.repeat(200) },
      ];
      const bottomPosts = [
        { text: 'c'.repeat(50) },
        { text: 'd'.repeat(150) },
      ];
      const result = analyzeTextFeatures(topPosts, bottomPosts);
      expect(result.avgLength.top).toBe(150);
      expect(result.avgLength.bottom).toBe(100);
    });

    test('問いかけの含有率を正しく計算する', () => {
      const topPosts = [
        { text: 'これはどう思いますか？' },
        { text: '普通のテキスト' },
      ];
      const bottomPosts = [
        { text: '普通のテキスト1' },
        { text: '普通のテキスト2' },
      ];
      const result = analyzeTextFeatures(topPosts, bottomPosts);
      expect(result.hasQuestion.topRate).toBe(50);
      expect(result.hasQuestion.bottomRate).toBe(0);
    });

    test('引用（「」）の含有率を正しく計算する', () => {
      const topPosts = [
        { text: '「すごい！」とゲストが言った' },
        { text: '「ありがとう」と言われた' },
      ];
      const bottomPosts = [
        { text: '普通のテキスト' },
      ];
      const result = analyzeTextFeatures(topPosts, bottomPosts);
      expect(result.hasQuotes.topRate).toBe(100);
      expect(result.hasQuotes.bottomRate).toBe(0);
    });

    test('数字の含有率を正しく計算する', () => {
      const topPosts = [
        { text: '500回以上のツアー' },
        { text: 'テキストだけ' },
      ];
      const bottomPosts = [
        { text: '数字なし' },
      ];
      const result = analyzeTextFeatures(topPosts, bottomPosts);
      expect(result.hasNumbers.topRate).toBe(50);
      expect(result.hasNumbers.bottomRate).toBe(0);
    });

    test('改行数の平均を正しく計算する', () => {
      const topPosts = [
        { text: '行1\n行2\n行3' },
        { text: '行1\n行2' },
      ];
      const bottomPosts = [
        { text: '改行なし' },
      ];
      const result = analyzeTextFeatures(topPosts, bottomPosts);
      expect(result.avgLineBreaks.top).toBe(1.5);
      expect(result.avgLineBreaks.bottom).toBe(0);
    });

    test('text が null や undefined の場合でもエラーにならない', () => {
      const topPosts = [{ text: null }, { text: undefined }];
      const bottomPosts = [{ text: '' }];
      const result = analyzeTextFeatures(topPosts, bottomPosts);
      expect(result.avgLength.top).toBe(0);
      expect(result.avgLength.bottom).toBe(0);
    });
  });

  describe('summarizePost', () => {
    test('投稿を要約形式に変換する', () => {
      const post = {
        id: 1,
        text: 'テスト投稿テキスト',
        engagement_rate: 5.5,
        impression_count: 1000,
        like_count: 50,
        retweet_count: 10,
        reply_count: 5,
        theme_category: 'T-A',
        posted_at: '2026-01-01T00:00:00Z'
      };
      const result = summarizePost(post);
      expect(result.id).toBe(1);
      expect(result.text).toBe('テスト投稿テキスト');
      expect(result.engagementRate).toBe(5.5);
      expect(result.impressions).toBe(1000);
      expect(result.likes).toBe(50);
      expect(result.retweets).toBe(10);
      expect(result.replies).toBe(5);
      expect(result.themeCategory).toBe('T-A');
    });

    test('100文字を超えるテキストは省略される', () => {
      const longText = 'あ'.repeat(150);
      const post = {
        id: 1,
        text: longText,
        engagement_rate: 5.5,
        impression_count: 1000,
        like_count: 50,
        retweet_count: 10,
        reply_count: 5,
        theme_category: 'T-A',
        posted_at: '2026-01-01T00:00:00Z'
      };
      const result = summarizePost(post);
      expect(result.text).toHaveLength(103); // 100 + '...'
      expect(result.text.endsWith('...')).toBe(true);
    });

    test('text が null の場合は空文字を返す', () => {
      const post = { id: 1, text: null };
      const result = summarizePost(post);
      expect(result.text).toBe('');
    });
  });

  describe('parseImprovementSuggestions', () => {
    test('正しいJSONから提案を抽出する', () => {
      const text = '{"suggestions":[{"category":"content","priority":"high","title":"テスト","description":"テスト説明","action":"テストアクション"}]}';
      const result = parseImprovementSuggestions(text);
      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('content');
      expect(result[0].priority).toBe('high');
      expect(result[0].title).toBe('テスト');
    });

    test('コードフェンス付きJSONからも抽出できる', () => {
      const text = '```json\n{"suggestions":[{"category":"timing","priority":"medium","title":"時間帯","description":"説明","action":"アクション"}]}\n```';
      const result = parseImprovementSuggestions(text);
      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('timing');
    });

    test('周囲にテキストがあるJSONからも抽出できる', () => {
      const text = '分析結果:\n{"suggestions":[{"category":"style","priority":"low","title":"スタイル","description":"説明","action":"アクション"}]}\n以上です。';
      const result = parseImprovementSuggestions(text);
      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('style');
    });

    test('複数の提案を正しく抽出する', () => {
      const text = '{"suggestions":[{"category":"content","priority":"high","title":"1","description":"d1","action":"a1"},{"category":"timing","priority":"medium","title":"2","description":"d2","action":"a2"}]}';
      const result = parseImprovementSuggestions(text);
      expect(result).toHaveLength(2);
    });

    test('不正なJSONの場合はフォールバックで1件の提案を返す', () => {
      const text = 'これは改善提案です。投稿時間を変えましょう。';
      const result = parseImprovementSuggestions(text);
      expect(result).toHaveLength(1);
      expect(result[0].category).toBe('content');
      expect(result[0].title).toBe('改善分析結果');
      expect(result[0].description).toContain('改善提案');
    });

    test('空テキストの場合は空配列を返す', () => {
      const result = parseImprovementSuggestions('');
      expect(result).toEqual([]);
    });

    test('空白のみのテキストの場合は空配列を返す', () => {
      const result = parseImprovementSuggestions('   ');
      expect(result).toEqual([]);
    });

    test('カテゴリが欠損している場合はデフォルト値を使う', () => {
      const text = '{"suggestions":[{"title":"テスト","description":"説明","action":"アクション"}]}';
      const result = parseImprovementSuggestions(text);
      expect(result[0].category).toBe('content');
      expect(result[0].priority).toBe('medium');
    });
  });

  describe('buildAnalysisPrompt', () => {
    test('分析データからプロンプトを正しく生成する', () => {
      const analysis = {
        postCount: 10,
        overallStats: {
          avgEngagementRate: 3.5,
          avgImpressions: 1500,
          avgLikes: 25
        },
        topPosts: [
          { text: '高パフォ投稿', engagementRate: 8.0, impressions: 3000 }
        ],
        bottomPosts: [
          { text: '低パフォ投稿', engagementRate: 0.5, impressions: 200 }
        ],
        categoryAnalysis: [
          { category: 'T-A', avgEngagementRate: 5.0, postCount: 3 }
        ],
        timeAnalysis: {
          hourlyPerformance: [
            { hour: 9, avgEngagementRate: 6.0, postCount: 5 }
          ]
        },
        textAnalysis: {
          avgLength: { top: 120, bottom: 80 },
          hasQuestion: { topRate: 60, bottomRate: 20 },
          hasQuotes: { topRate: 80, bottomRate: 10 },
          hasNumbers: { topRate: 70, bottomRate: 30 },
          avgLineBreaks: { top: 3, bottom: 1 }
        }
      };

      const prompt = buildAnalysisPrompt(analysis);

      expect(prompt).toContain('10件');
      expect(prompt).toContain('3.5%');
      expect(prompt).toContain('高パフォ投稿');
      expect(prompt).toContain('低パフォ投稿');
      expect(prompt).toContain('T-A');
      expect(prompt).toContain('9時');
      expect(prompt).toContain('120字');
      expect(prompt).toContain('JSON形式');
      expect(prompt).toContain('suggestions');
    });
  });

  describe('generateImprovementInsights', () => {
    function setupInsightsMock(posts) {
      const queryChain = {};
      queryChain.select = jest.fn().mockReturnValue(queryChain);
      queryChain.eq = jest.fn().mockReturnValue(queryChain);
      queryChain.not = jest.fn().mockReturnValue(queryChain);
      queryChain.gt = jest.fn().mockReturnValue(queryChain);
      queryChain.order = jest.fn().mockReturnValue(queryChain);
      queryChain.limit = jest.fn().mockResolvedValue({ data: posts, error: null });

      const insertChain = {};
      insertChain.select = jest.fn().mockReturnValue(insertChain);
      insertChain.single = jest.fn().mockResolvedValue({ data: { id: 99 }, error: null });

      getDb.mockReturnValue({
        from: jest.fn((table) => {
          if (table === 'improvement_analyses') return { insert: jest.fn().mockReturnValue(insertChain) };
          return queryChain;
        })
      });
    }

    const samplePosts = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      text: `テスト投稿${i + 1}`,
      post_type: 'new',
      theme_category: i % 2 === 0 ? 'T-A' : 'T-B',
      engagement_rate: (i + 1) * 0.5,
      like_count: (i + 1) * 5,
      retweet_count: i,
      reply_count: 1,
      quote_count: 0,
      impression_count: (i + 1) * 100,
      bookmark_count: 0,
      ai_provider: 'claude',
      ai_model: 'claude-sonnet-4-20250514',
      posted_at: `2026-01-${String(i + 1).padStart(2, '0')}T09:00:00Z`
    }));

    beforeEach(() => {
      mockGenerateTweets.mockClear();
      getAIProvider.mockClear();
    });

    test('modelId を指定すると AI プロバイダに model が渡される', async () => {
      setupInsightsMock(samplePosts);

      await generateImprovementInsights('account-1', 'claude', 'claude-haiku-4-5-20251001');

      expect(getAIProvider).toHaveBeenCalledWith('claude');
      expect(mockGenerateTweets).toHaveBeenCalledTimes(1);
      const opts = mockGenerateTweets.mock.calls[0][1];
      expect(opts.model).toBe('claude-haiku-4-5-20251001');
      expect(opts.taskType).toBe('performance_summary');
    });

    test('modelId を指定しない場合は model が opts に含まれない', async () => {
      setupInsightsMock(samplePosts);

      await generateImprovementInsights('account-1', 'claude');

      expect(mockGenerateTweets).toHaveBeenCalledTimes(1);
      const opts = mockGenerateTweets.mock.calls[0][1];
      expect(opts.model).toBeUndefined();
      expect(opts.taskType).toBe('performance_summary');
    });

    test('provider 未指定時はデフォルトで claude が使われる', async () => {
      setupInsightsMock(samplePosts);

      await generateImprovementInsights('account-1');

      expect(getAIProvider).toHaveBeenCalledWith('claude');
    });
  });

  describe('analyzePostPerformance', () => {
    function setupAnalysisMock(data, error = null) {
      // Build chain: select().eq('status').eq('account_id').not().gt().order().limit()
      // Each method returns 'this' (the chain), with limit resolving the final promise
      const chain = {};
      chain.select = jest.fn().mockReturnValue(chain);
      chain.eq = jest.fn().mockReturnValue(chain);
      chain.not = jest.fn().mockReturnValue(chain);
      chain.gt = jest.fn().mockReturnValue(chain);
      chain.order = jest.fn().mockReturnValue(chain);
      chain.limit = jest.fn().mockResolvedValue({ data, error });

      getDb.mockReturnValue({
        from: jest.fn().mockReturnValue(chain)
      });
      return chain;
    }

    test('投稿数が不足している場合は insufficient_data を返す', async () => {
      setupAnalysisMock([
        { id: 1, text: 'test', engagement_rate: 5.0, impression_count: 100 },
        { id: 2, text: 'test2', engagement_rate: 3.0, impression_count: 200 },
      ]);

      const result = await analyzePostPerformance('account-1');
      expect(result.status).toBe('insufficient_data');
      expect(result.postCount).toBe(2);
      expect(result.minRequired).toBe(MIN_POSTS_FOR_ANALYSIS);
    });

    test('十分な投稿がある場合は分析結果を返す', async () => {
      const posts = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        text: `テスト投稿${i + 1}`,
        post_type: 'new',
        theme_category: i % 2 === 0 ? 'T-A' : 'T-B',
        engagement_rate: (i + 1) * 0.5,
        like_count: (i + 1) * 5,
        retweet_count: i,
        reply_count: 1,
        quote_count: 0,
        impression_count: (i + 1) * 100,
        bookmark_count: 0,
        ai_provider: 'claude',
        ai_model: 'claude-sonnet-4-20250514',
        posted_at: `2026-01-${String(i + 1).padStart(2, '0')}T09:00:00Z`
      }));

      setupAnalysisMock(posts);

      const result = await analyzePostPerformance('account-1');
      expect(result.status).toBe('ok');
      expect(result.postCount).toBe(10);
      expect(result.overallStats.avgEngagementRate).toBeGreaterThan(0);
      expect(result.topPosts.length).toBeGreaterThan(0);
      expect(result.bottomPosts.length).toBeGreaterThan(0);
      expect(result.categoryAnalysis.length).toBeGreaterThan(0);
      expect(result.textAnalysis).toBeDefined();
    });

    test('DBエラー時はエラーを投げる', async () => {
      setupAnalysisMock(null, { message: 'connection failed' });

      await expect(analyzePostPerformance('account-1')).rejects.toThrow('投稿データの取得に失敗');
    });
  });

  describe('buildPerformanceContextBlock', () => {
    function setupContextMock(data, error = null) {
      const chain = {};
      chain.select = jest.fn().mockReturnValue(chain);
      chain.eq = jest.fn().mockReturnValue(chain);
      chain.not = jest.fn().mockReturnValue(chain);
      chain.gt = jest.fn().mockReturnValue(chain);
      chain.order = jest.fn().mockReturnValue(chain);
      chain.limit = jest.fn().mockResolvedValue({ data, error });

      getDb.mockReturnValue({
        from: jest.fn().mockReturnValue(chain)
      });
    }

    test('投稿数が不足している場合は空文字を返す', async () => {
      setupContextMock([
        { id: 1, text: 'test', engagement_rate: 5.0, impression_count: 100 }
      ]);

      const result = await buildPerformanceContextBlock('account-1');
      expect(result).toBe('');
    });

    test('十分な投稿がある場合はパフォーマンスコンテキストを返す', async () => {
      const posts = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        text: `テスト投稿${i + 1}${'？'.repeat(i % 2)}`,
        post_type: 'new',
        theme_category: i % 2 === 0 ? 'T-A' : 'T-B',
        engagement_rate: (i + 1) * 0.5,
        like_count: (i + 1) * 5,
        retweet_count: i,
        reply_count: 1,
        quote_count: 0,
        impression_count: (i + 1) * 100,
        bookmark_count: 0,
        posted_at: `2026-01-${String(i + 1).padStart(2, '0')}T09:00:00Z`
      }));

      setupContextMock(posts);

      const result = await buildPerformanceContextBlock('account-1');
      expect(result).toContain('パフォーマンスフィードバック');
      expect(result).toContain('平均ER');
    });

    test('エラー時は空文字を返す（エラーを投げない）', async () => {
      getDb.mockImplementation(() => { throw new Error('connection failed'); });

      const result = await buildPerformanceContextBlock('account-1');
      expect(result).toBe('');
    });
  });
});
