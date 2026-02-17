const express = require('express');
const http = require('http');

// Mock database - Supabase-like chainable query builder
// The chain is thennable so `await chain.update().eq()` resolves to { data: null, error: null }
const mockChain = {};
const mockUpsert = jest.fn().mockResolvedValue({ error: null });
const mockSelect = jest.fn(() => mockChain);
const mockUpdate = jest.fn(() => mockChain);
const mockInsert = jest.fn(() => mockChain);
const mockEq = jest.fn(() => mockChain);
const mockOrder = jest.fn(() => mockChain);
const mockLimit = jest.fn(() => mockChain);
const mockSingle = jest.fn().mockResolvedValue({ data: null, error: null });
const mockIn = jest.fn(() => mockChain);
const mockGte = jest.fn(() => mockChain);

Object.assign(mockChain, {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  upsert: mockUpsert,
  delete: jest.fn(() => mockChain),
  eq: mockEq,
  order: mockOrder,
  limit: mockLimit,
  single: mockSingle,
  in: mockIn,
  gte: mockGte,
  // Make the chain thennable so `await chain` resolves to { data: null, error: null }
  then: jest.fn((resolve) => resolve({ data: null, error: null })),
});

const mockFrom = jest.fn(() => mockChain);

jest.mock('../../server/db/database', () => ({
  getDb: jest.fn(() => ({ from: mockFrom }))
}));

const settingsRouter = require('../../server/routes/settings');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/settings', settingsRouter);
  return app;
}

// Inline supertest-like helper using native http
function request(app) {
  const server = http.createServer(app);
  return {
    get(path) { return new RequestBuilder(server, 'GET', path); },
    post(path) { return new RequestBuilder(server, 'POST', path); },
    put(path) { return new RequestBuilder(server, 'PUT', path); },
    delete(path) { return new RequestBuilder(server, 'DELETE', path); },
  };
}

class RequestBuilder {
  constructor(server, method, path) {
    this._server = server;
    this._method = method;
    this._path = path;
    this._body = null;
    this._headers = { 'Content-Type': 'application/json' };
  }
  send(body) { this._body = body; return this; }
  set(header, value) { this._headers[header] = value; return this; }
  then(resolve, reject) { return this._execute().then(resolve, reject); }
  _execute() {
    return new Promise((resolve, reject) => {
      this._server.listen(0, () => {
        const port = this._server.address().port;
        const bodyStr = this._body ? JSON.stringify(this._body) : '';
        const options = {
          hostname: '127.0.0.1', port,
          path: this._path,
          method: this._method,
          headers: { ...this._headers, 'Content-Length': Buffer.byteLength(bodyStr) }
        };
        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            this._server.close();
            let body;
            try { body = JSON.parse(data); } catch { body = data; }
            resolve({ status: res.statusCode, body });
          });
        });
        req.on('error', (err) => { this._server.close(); reject(err); });
        if (bodyStr) req.write(bodyStr);
        req.end();
      });
    });
  }
}

describe('settings routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset default chain behavior - chainable methods return mockChain
    mockSelect.mockImplementation(() => mockChain);
    mockEq.mockImplementation(() => mockChain);
    mockOrder.mockImplementation(() => mockChain);
    mockLimit.mockImplementation(() => mockChain);
    mockIn.mockImplementation(() => mockChain);
    mockGte.mockImplementation(() => mockChain);
    mockUpdate.mockImplementation(() => mockChain);
    mockInsert.mockImplementation(() => mockChain);
    // Terminal methods resolve to values
    mockSingle.mockResolvedValue({ data: null, error: null });
    mockUpsert.mockResolvedValue({ error: null });
    // Default thennable resolution
    mockChain.then = jest.fn((resolve) => resolve({ data: null, error: null }));
  });

  describe('GET /api/settings', () => {
    test('設定一覧を取得する', async () => {
      // .select().limit() chain - mock limit as terminal
      mockLimit.mockReturnValueOnce({
        ...mockChain,
        then: (resolve) => resolve({
          data: [
            { key: 'system_prompt', value: 'test prompt' },
            { key: 'monthly_budget_usd', value: '33' }
          ],
          error: null
        })
      });

      const app = createApp();
      const res = await request(app).get('/api/settings');
      expect(res.status).toBe(200);
      expect(res.body.system_prompt).toBe('test prompt');
      expect(res.body.monthly_budget_usd).toBe('33');
    });

    test('DB エラー時は 500 を返す', async () => {
      mockLimit.mockReturnValueOnce({
        ...mockChain,
        then: (resolve) => resolve({
          data: null,
          error: new Error('DB connection failed')
        })
      });

      const app = createApp();
      const res = await request(app).get('/api/settings');
      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('PUT /api/settings', () => {
    test('設定を正常に保存できる（バッチ upsert）', async () => {
      const app = createApp();
      const res = await request(app).put('/api/settings').send({
        system_prompt: 'updated prompt',
        monthly_budget_usd: '50'
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('settings');
      // Batch upsert: single call with array
      expect(mockUpsert).toHaveBeenCalledTimes(1);
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          { key: 'system_prompt', value: 'updated prompt' },
          { key: 'monthly_budget_usd', value: '50' }
        ]),
        { onConflict: 'key' }
      );
    });

    test('許可されたキーのみ upsert される', async () => {
      const app = createApp();
      await request(app).put('/api/settings').send({
        system_prompt: 'new prompt',
        default_hashtags: '#test',
        unknown_key: 'should be filtered'
      });

      const upsertRows = mockUpsert.mock.calls[0][0];
      expect(upsertRows).toHaveLength(2);
      expect(upsertRows).toEqual(expect.arrayContaining([
        { key: 'system_prompt', value: 'new prompt' },
        { key: 'default_hashtags', value: '#test' }
      ]));
    });

    test('upsert エラー時は 500 を返す', async () => {
      mockUpsert.mockResolvedValueOnce({ error: new Error('upsert failed') });

      const app = createApp();
      const res = await request(app).put('/api/settings').send({
        system_prompt: 'test'
      });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('upsert failed');
    });

    test('空のボディでも success を返す', async () => {
      const app = createApp();
      const res = await request(app).put('/api/settings').send({});
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockUpsert).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/settings/cost', () => {
    test('コスト設定を正常に保存できる', async () => {
      mockSingle.mockResolvedValueOnce({ data: { id: 1 }, error: null });

      const app = createApp();
      const res = await request(app).put('/api/settings/cost').send({
        monthly_budget_usd: 50,
        cache_enabled: true,
        batch_enabled: false
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('既存レコードがない場合は insert する', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: null });

      const app = createApp();
      const res = await request(app).put('/api/settings/cost').send({
        monthly_budget_usd: 33
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockInsert).toHaveBeenCalled();
    });

    test('monthly_budget_usd を settings テーブルにも同期する', async () => {
      mockSingle.mockResolvedValueOnce({ data: { id: 1 }, error: null });

      const app = createApp();
      await request(app).put('/api/settings/cost').send({
        monthly_budget_usd: 50
      });

      // settings テーブルへの upsert も呼ばれる
      expect(mockUpsert).toHaveBeenCalledWith(
        { key: 'monthly_budget_usd', value: '50' },
        { onConflict: 'key' }
      );
    });
  });

  describe('テーブル未作成時のフォールバック', () => {
    const TABLE_NOT_FOUND_ERROR = { message: "Could not find the table 'public.cost_settings' in the schema cache" };

    test('GET /api/settings/cost - テーブルがない場合はデフォルト値を返す', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: TABLE_NOT_FOUND_ERROR });
      // KV fallback: settings テーブルからの読み取り（空）
      mockIn.mockImplementationOnce(() => ({
        ...mockChain,
        then: (resolve) => resolve({ data: [] })
      }));

      const app = createApp();
      const res = await request(app).get('/api/settings/cost');
      expect(res.status).toBe(200);
      expect(res.body.monthly_budget_usd).toBe(33);
      expect(res.body.cache_enabled).toBe(true);
    });

    test('PUT /api/settings/cost - テーブルがない場合は settings テーブルにフォールバック保存', async () => {
      mockSingle.mockResolvedValueOnce({
        data: null,
        error: { message: "Could not find the table 'public.cost_settings' in the schema cache" }
      });

      const app = createApp();
      const res = await request(app).put('/api/settings/cost').send({
        monthly_budget_usd: 50,
        cache_enabled: true
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // cost settings がバッチで KV テーブルに保存される
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.arrayContaining([
          { key: 'cost_monthly_budget_usd', value: '50' },
          { key: 'cost_cache_enabled', value: 'true' }
        ]),
        { onConflict: 'key' }
      );
      // monthly_budget_usd は settings テーブルにも同期
      expect(mockUpsert).toHaveBeenCalledWith(
        { key: 'monthly_budget_usd', value: '50' },
        { onConflict: 'key' }
      );
    });

    test('PUT /api/settings/prompts - テーブルがない場合は settings テーブルにフォールバック保存', async () => {
      mockUpsert.mockResolvedValueOnce({
        error: { message: "relation \"public.custom_prompts\" does not exist" }
      });

      const app = createApp();
      const res = await request(app).put('/api/settings/prompts/tweet_generation').send({
        system_prompt: 'test prompt',
        user_template: 'test template'
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // JSON として settings テーブルに保存される
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'prompt_tweet_generation'
        }),
        { onConflict: 'key' }
      );
    });

    test('PUT /api/settings/task-models - テーブルがない場合は settings テーブルにフォールバック保存', async () => {
      mockUpsert
        .mockResolvedValueOnce({
          error: { message: "Could not find the table 'public.task_model_settings' in the schema cache" }
        })
        .mockResolvedValueOnce({ error: null });

      const app = createApp();
      const res = await request(app).put('/api/settings/task-models/tweet_generation').send({
        claude_model: 'claude-sonnet-4-20250514',
        effort: 'medium'
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // JSON として settings テーブルに保存される
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'task_model_tweet_generation'
        }),
        { onConflict: 'key' }
      );
    });
  });

  describe('PUT /api/settings/task-models/:taskType', () => {
    test('タスクモデル設定を保存できる', async () => {
      const app = createApp();
      const res = await request(app).put('/api/settings/task-models/tweet_generation').send({
        claude_model: 'claude-sonnet-4-20250514',
        effort: 'medium',
        max_tokens: 512
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    test('未知のフィールドは無視される', async () => {
      const app = createApp();
      await request(app).put('/api/settings/task-models/tweet_generation').send({
        claude_model: 'claude-sonnet-4-20250514',
        unknown_field: 'should be ignored'
      });

      const upsertCall = mockUpsert.mock.calls[0][0];
      expect(upsertCall).not.toHaveProperty('unknown_field');
      expect(upsertCall).toHaveProperty('claude_model', 'claude-sonnet-4-20250514');
    });
  });

  describe('GET /api/settings/usage', () => {
    test('API利用状況と内訳を返す', async () => {
      // api_usage_log: .gte().limit() - mock limit as terminal (1st call)
      mockLimit.mockReturnValueOnce({
        ...mockChain,
        then: (resolve) => resolve({
          data: [
            { api_type: 'x_write', cost_usd: 0.01, created_at: '2026-02-01T00:00:00Z' },
            { api_type: 'x_write', cost_usd: 0.01, created_at: '2026-02-01T00:00:00Z' },
            { api_type: 'x_read', cost_usd: 0.005, created_at: '2026-02-02T00:00:00Z' },
          ],
          error: null
        })
      });

      // api_usage_logs: .gte().limit() - mock limit as terminal (2nd call)
      mockLimit.mockReturnValueOnce({
        ...mockChain,
        then: (resolve) => resolve({
          data: [
            { provider: 'claude', model: 'claude-sonnet-4-20250514', estimated_cost_usd: 0.05, timestamp: '2026-02-01T00:00:00Z' },
            { provider: 'claude', model: 'claude-haiku-4-5-20251001', estimated_cost_usd: 0.01, timestamp: '2026-02-02T00:00:00Z' },
          ],
          error: null
        })
      });

      // Budget rows from settings (no limit, uses .in() as terminal)
      mockIn.mockImplementationOnce(() => ({
        ...mockChain,
        then: (resolve) => resolve({
          data: [
            { key: 'monthly_budget_usd', value: '33' },
            { key: 'budget_x_api_usd', value: '10' },
            { key: 'budget_claude_usd', value: '13' },
          ],
          error: null
        })
      }));

      const app = createApp();
      const res = await request(app).get('/api/settings/usage');
      expect(res.status).toBe(200);

      // Total cost
      expect(res.body.totalCostUsd).toBeGreaterThan(0);
      expect(res.body.budgetUsd).toBe(33);

      // APIs array
      expect(res.body.apis).toHaveLength(3);

      // X API breakdown
      const xApi = res.body.apis.find(a => a.category === 'x');
      expect(xApi).toBeDefined();
      expect(xApi.call_count).toBe(3);
      expect(xApi.breakdown).toBeDefined();
      expect(xApi.breakdown.length).toBeGreaterThanOrEqual(2);
      const xWriteBreakdown = xApi.breakdown.find(b => b.key === 'x_write');
      expect(xWriteBreakdown).toBeDefined();
      expect(xWriteBreakdown.call_count).toBe(2);

      // Claude breakdown by model
      const claudeApi = res.body.apis.find(a => a.category === 'claude');
      expect(claudeApi).toBeDefined();
      expect(claudeApi.breakdown).toBeDefined();
      expect(claudeApi.breakdown.length).toBe(2);
    });

    test('利用データがない場合も正常に返す', async () => {
      // api_usage_log: empty (limit terminal)
      mockLimit.mockReturnValueOnce({
        ...mockChain,
        then: (resolve) => resolve({ data: [], error: null })
      });
      // api_usage_logs: empty (limit terminal)
      mockLimit.mockReturnValueOnce({
        ...mockChain,
        then: (resolve) => resolve({ data: [], error: null })
      });
      // Budget rows (in terminal)
      mockIn.mockImplementationOnce(() => ({
        ...mockChain,
        then: (resolve) => resolve({ data: [], error: null })
      }));

      const app = createApp();
      const res = await request(app).get('/api/settings/usage');
      expect(res.status).toBe(200);
      expect(res.body.totalCostUsd).toBe(0);
      expect(res.body.apis).toHaveLength(3);

      // Each API should have empty breakdown
      for (const api of res.body.apis) {
        expect(api.breakdown).toEqual([]);
        expect(api.call_count).toBe(0);
      }
    });
  });

  describe('PUT /api/settings/prompts/:taskType', () => {
    test('カスタムプロンプトを保存できる', async () => {
      const app = createApp();
      const res = await request(app).put('/api/settings/prompts/tweet_generation').send({
        system_prompt: 'custom system prompt',
        user_template: 'custom template'
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          task_type: 'tweet_generation',
          system_prompt: 'custom system prompt',
          user_template: 'custom template',
          is_custom: true
        }),
        { onConflict: 'task_type' }
      );
    });

    test('upsert エラー時は 500 を返す', async () => {
      mockUpsert.mockResolvedValueOnce({ error: new Error('prompt save failed') });

      const app = createApp();
      const res = await request(app).put('/api/settings/prompts/tweet_generation').send({
        system_prompt: 'test',
        user_template: 'test'
      });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('prompt save failed');
    });
  });
});
