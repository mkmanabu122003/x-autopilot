// Mock database
jest.mock('../../server/db/database', () => {
  const mockChain = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
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

// Mock x-api
jest.mock('../../server/services/x-api', () => ({
  logApiUsage: jest.fn().mockResolvedValue(undefined)
}));

// Mock cost-calculator
jest.mock('../../server/services/cost-calculator', () => ({
  logDetailedUsage: jest.fn().mockResolvedValue(undefined),
  checkBudgetStatus: jest.fn().mockResolvedValue({ shouldPause: false })
}));

const { getAIProvider, getAvailableModels, AIProvider, ClaudeProvider, fetchWithRetry } = require('../../server/services/ai-provider');

describe('ai-provider', () => {
  describe('getAvailableModels', () => {
    test('claude と gemini の両プロバイダーを返す', () => {
      const models = getAvailableModels();
      expect(models).toHaveProperty('claude');
      expect(models).toHaveProperty('gemini');
    });

    test('claude プロバイダーにモデル一覧がある', () => {
      const models = getAvailableModels();
      expect(models.claude.models.length).toBeGreaterThan(0);
      const ids = models.claude.models.map(m => m.id);
      expect(ids).toContain('claude-sonnet-4-20250514');
      expect(ids).toContain('claude-opus-4-6');
      expect(ids).toContain('claude-haiku-4-5-20251001');
    });

    test('gemini プロバイダーにモデル一覧がある', () => {
      const models = getAvailableModels();
      expect(models.gemini.models.length).toBeGreaterThan(0);
      const ids = models.gemini.models.map(m => m.id);
      expect(ids).toContain('gemini-2.0-flash');
      expect(ids).toContain('gemini-2.5-pro');
    });

    test('各モデルに id と label がある', () => {
      const models = getAvailableModels();
      for (const provider of Object.values(models)) {
        for (const model of provider.models) {
          expect(model).toHaveProperty('id');
          expect(model).toHaveProperty('label');
          expect(typeof model.id).toBe('string');
          expect(typeof model.label).toBe('string');
        }
      }
    });
  });

  describe('getAIProvider', () => {
    test('claude プロバイダーを返す', () => {
      const provider = getAIProvider('claude');
      expect(provider).toBeInstanceOf(ClaudeProvider);
    });

    test('gemini プロバイダーを返す', () => {
      const provider = getAIProvider('gemini');
      expect(provider).toBeDefined();
    });

    test('不明なプロバイダーでエラーを投げる', () => {
      expect(() => getAIProvider('openai')).toThrow('Unknown AI provider: openai');
    });

    test('空文字列でエラーを投げる', () => {
      expect(() => getAIProvider('')).toThrow('Unknown AI provider: ');
    });
  });

  describe('AIProvider.inferTaskType', () => {
    let provider;

    beforeEach(() => {
      provider = new AIProvider();
    });

    test('quote タイプを正しく推論', () => {
      expect(provider.inferTaskType('quote')).toBe('quote_rt_generation');
    });

    test('reply タイプを正しく推論', () => {
      expect(provider.inferTaskType('reply')).toBe('reply_generation');
    });

    test('analysis タイプを正しく推論', () => {
      expect(provider.inferTaskType('analysis')).toBe('competitor_analysis');
    });

    test('summary タイプを正しく推論', () => {
      expect(provider.inferTaskType('summary')).toBe('performance_summary');
    });

    test('デフォルトは tweet_generation', () => {
      expect(provider.inferTaskType('new')).toBe('tweet_generation');
      expect(provider.inferTaskType(undefined)).toBe('tweet_generation');
      expect(provider.inferTaskType('')).toBe('tweet_generation');
    });
  });

  describe('AIProvider.parseCandidates', () => {
    let provider;

    beforeEach(() => {
      provider = new AIProvider();
    });

    test('JSON形式のvariants配列をパースする', () => {
      const text = '{"variants":[{"label":"共感型","body":"テスト投稿1","char_count":5},{"label":"情報型","body":"テスト投稿2","char_count":5}]}';
      const result = provider.parseCandidates(text);
      expect(result).toHaveLength(2);
      expect(result[0].text).toBe('テスト投稿1');
      expect(result[0].label).toBe('共感型');
      expect(result[1].text).toBe('テスト投稿2');
    });

    test('JSON形式で最大3つまでの候補を返す', () => {
      const variants = Array.from({ length: 5 }, (_, i) => ({
        label: `label${i}`,
        body: `body${i}`,
        char_count: 5
      }));
      const text = JSON.stringify({ variants });
      const result = provider.parseCandidates(text);
      expect(result).toHaveLength(3);
    });

    test('番号付きパターンをパースする', () => {
      const text = '1. 最初のツイート案\n2. 二番目のツイート案\n3. 三番目のツイート案';
      const result = provider.parseCandidates(text);
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result.length).toBeLessThanOrEqual(3);
    });

    test('パターンN形式をパースする', () => {
      const text = 'パターン1：最初のツイート\nパターン2：二番目のツイート';
      const result = provider.parseCandidates(text);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    test('プレーンテキストの場合は1つの候補を返す', () => {
      const text = 'これはシンプルなツイートです';
      const result = provider.parseCandidates(text);
      expect(result.length).toBeGreaterThanOrEqual(1);
      expect(result[0].text).toBeTruthy();
    });

    test('空文字列でもエラーにならない（空配列を返す）', () => {
      const result = provider.parseCandidates('');
      expect(result).toEqual([]);
    });

    test('JSON周辺にテキストがあっても正しくパースする', () => {
      const text = 'はい、以下が候補です。\n{"variants":[{"label":"テスト","body":"ツイート内容","char_count":6}]}\n以上です。';
      const result = provider.parseCandidates(text);
      expect(result).toHaveLength(1);
      expect(result[0].text).toBe('ツイート内容');
    });

    test('body が無い場合は text フィールドを使う', () => {
      const text = '{"variants":[{"label":"テスト","text":"代替テキスト","char_count":5}]}';
      const result = provider.parseCandidates(text);
      expect(result[0].text).toBe('代替テキスト');
    });
  });

  describe('fetchWithRetry', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.restoreAllMocks();
    });

    test('成功レスポンスをそのまま返す', async () => {
      const mockResponse = { ok: true, json: async () => ({ result: 'ok' }) };
      jest.spyOn(global, 'fetch').mockResolvedValue(mockResponse);

      const result = await fetchWithRetry('https://example.com/api', { method: 'POST' });
      expect(result).toBe(mockResponse);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('429エラーでリトライしてから成功する', async () => {
      const mock429 = { ok: false, status: 429, json: async () => ({ error: 'rate limit' }) };
      const mockOk = { ok: true, json: async () => ({ result: 'ok' }) };

      jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce(mock429)
        .mockResolvedValueOnce(mockOk);

      const promise = fetchWithRetry('https://example.com/api', { method: 'POST' }, { initialBackoffMs: 10 });

      // Advance timers to allow sleep to resolve
      await jest.advanceTimersByTimeAsync(10);

      const result = await promise;
      expect(result).toBe(mockOk);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('429エラーが最大リトライ回数を超えるとレート制限エラーを投げる', async () => {
      jest.useRealTimers();
      const mock429 = { ok: false, status: 429, json: async () => ({ error: 'rate limit' }) };

      jest.spyOn(global, 'fetch').mockResolvedValue(mock429);

      await expect(
        fetchWithRetry('https://example.com/api', { method: 'POST' }, { maxRetries: 2, initialBackoffMs: 1 })
      ).rejects.toThrow('APIレート制限に達しました');
      expect(global.fetch).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    test('429以外のエラーはリトライせず即座にスローする', async () => {
      const mock500 = { ok: false, status: 500, json: async () => ({ error: 'server error' }) };

      jest.spyOn(global, 'fetch').mockResolvedValue(mock500);

      await expect(
        fetchWithRetry('https://example.com/api', { method: 'POST' })
      ).rejects.toThrow('API error 500');
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('指数バックオフで待機時間が増加する', async () => {
      const mock429 = { ok: false, status: 429, json: async () => ({ error: 'rate limit' }) };
      const mockOk = { ok: true, json: async () => ({ result: 'ok' }) };

      jest.spyOn(global, 'fetch')
        .mockResolvedValueOnce(mock429)
        .mockResolvedValueOnce(mock429)
        .mockResolvedValueOnce(mockOk);

      const promise = fetchWithRetry('https://example.com/api', { method: 'POST' }, { initialBackoffMs: 100 });

      // First retry: 100ms
      await jest.advanceTimersByTimeAsync(100);
      // Second retry: 200ms
      await jest.advanceTimersByTimeAsync(200);

      const result = await promise;
      expect(result).toBe(mockOk);
      expect(global.fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('ClaudeProvider', () => {
    let provider;

    beforeEach(() => {
      provider = new ClaudeProvider();
    });

    test('Opus モデルを正しく識別する', () => {
      expect(provider.isOpusModel('claude-opus-4-6')).toBe(true);
      expect(provider.isOpusModel('claude-sonnet-4-20250514')).toBe(false);
      expect(provider.isOpusModel('claude-haiku-4-5-20251001')).toBe(false);
    });

    test('Opus モデル + 分析タスクには thinking 設定を返す', () => {
      const config = provider.getThinkingConfig('claude-opus-4-6', 'competitor_analysis');
      expect(config).toEqual({ type: 'enabled', budget_tokens: 1024 });
    });

    test('Opus モデル + サマリータスクには thinking 設定を返す', () => {
      const config = provider.getThinkingConfig('claude-opus-4-6', 'performance_summary');
      expect(config).toEqual({ type: 'enabled', budget_tokens: 1024 });
    });

    test('Opus モデルでもツイート生成タスクには thinking を返さない', () => {
      expect(provider.getThinkingConfig('claude-opus-4-6', 'tweet_generation')).toBeUndefined();
      expect(provider.getThinkingConfig('claude-opus-4-6', 'reply_generation')).toBeUndefined();
      expect(provider.getThinkingConfig('claude-opus-4-6', 'quote_rt_generation')).toBeUndefined();
      expect(provider.getThinkingConfig('claude-opus-4-6', 'comment_generation')).toBeUndefined();
    });

    test('非 Opus モデルにはどのタスクでも thinking 設定を返さない', () => {
      expect(provider.getThinkingConfig('claude-sonnet-4-20250514', 'competitor_analysis')).toBeUndefined();
      expect(provider.getThinkingConfig('claude-haiku-4-5-20251001', 'tweet_generation')).toBeUndefined();
    });

    test('null/undefined モデルでも isOpusModel がエラーにならない', () => {
      expect(provider.isOpusModel(null)).toBeFalsy();
      expect(provider.isOpusModel(undefined)).toBeFalsy();
    });
  });
});
