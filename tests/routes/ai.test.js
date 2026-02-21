const express = require('express');
const http = require('http');

// Mock database
const mockChain = {
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  in: jest.fn().mockReturnThis(),
  not: jest.fn().mockReturnThis(),
  gt: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: null, error: null }),
};

jest.mock('../../server/db/database', () => ({
  getDb: jest.fn(() => ({
    from: jest.fn(() => mockChain)
  }))
}));

// Mock AI provider
const mockGenerateTweets = jest.fn();
jest.mock('../../server/services/ai-provider', () => ({
  getAIProvider: jest.fn(() => ({
    generateTweets: mockGenerateTweets
  })),
  getAvailableModels: jest.fn(() => ({
    claude: { label: 'Claude', models: [{ id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' }] },
    gemini: { label: 'Gemini', models: [{ id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' }] }
  })),
  AIProvider: jest.fn()
}));

// Mock analytics
jest.mock('../../server/services/analytics', () => ({
  getCompetitorContext: jest.fn().mockResolvedValue('')
}));

const aiRouter = require('../../server/routes/ai');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiRouter);
  return app;
}

class RequestBuilder {
  constructor(server, method, path) {
    this._server = server;
    this._method = method;
    this._path = path;
    this._body = null;
    this._headers = { 'Content-Type': 'application/json' };
  }

  send(body) {
    this._body = body;
    return this;
  }

  then(resolve, reject) {
    return this._execute().then(resolve, reject);
  }

  _execute() {
    return new Promise((resolve, reject) => {
      this._server.listen(0, () => {
        const port = this._server.address().port;
        const bodyStr = this._body ? JSON.stringify(this._body) : null;
        const options = {
          hostname: 'localhost',
          port,
          path: this._path,
          method: this._method,
          headers: { ...this._headers }
        };
        if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            this._server.close();
            let body;
            try { body = JSON.parse(data); } catch (e) { body = data; }
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

function request(app) {
  const server = http.createServer(app);
  return {
    post: (path) => new RequestBuilder(server, 'POST', path),
    get: (path) => new RequestBuilder(server, 'GET', path),
    put: (path) => new RequestBuilder(server, 'PUT', path),
    delete: (path) => new RequestBuilder(server, 'DELETE', path),
  };
}

describe('AI Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockChain.select.mockReturnThis();
    mockChain.insert.mockReturnThis();
    mockChain.update.mockReturnThis();
    mockChain.delete.mockReturnThis();
    mockChain.eq.mockReturnThis();
    mockChain.order.mockReturnThis();
    mockChain.limit.mockReturnThis();
    mockChain.single.mockResolvedValue({ data: null, error: null });
  });

  describe('POST /api/ai/regenerate', () => {
    test('originalText が無いとき 400 を返す', async () => {
      const app = createApp();
      const res = await request(app).post('/api/ai/regenerate').send({ feedback: 'test' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch('originalText');
    });

    test('feedback が無いとき 400 を返す', async () => {
      const app = createApp();
      const res = await request(app).post('/api/ai/regenerate').send({ originalText: 'test' });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch('feedback');
    });

    test('正常にフィードバック再生成できる', async () => {
      mockGenerateTweets.mockResolvedValue({
        provider: 'claude',
        model: 'claude-sonnet-4-20250514',
        candidates: [{ text: '改善されたツイート', label: '改善版', hashtags: [] }]
      });

      const app = createApp();
      const res = await request(app).post('/api/ai/regenerate').send({
        originalText: '元のツイート',
        feedback: 'もっとカジュアルに',
        provider: 'claude'
      });
      expect(res.status).toBe(200);
      expect(res.body.candidates).toHaveLength(1);
      expect(res.body.candidates[0].text).toBe('改善されたツイート');
      expect(mockGenerateTweets).toHaveBeenCalledTimes(1);
    });

    test('カスタムプロンプトにフィードバックが含まれる', async () => {
      mockGenerateTweets.mockResolvedValue({
        provider: 'claude',
        candidates: []
      });

      const app = createApp();
      await request(app).post('/api/ai/regenerate').send({
        originalText: '元のツイート',
        feedback: 'もっと短く',
        provider: 'claude'
      });

      const callArgs = mockGenerateTweets.mock.calls[0];
      expect(callArgs[1].customPrompt).toContain('元のツイート');
      expect(callArgs[1].customPrompt).toContain('もっと短く');
    });
  });

  describe('POST /api/ai/decompose-feedback', () => {
    test('feedbackHistory が無いとき 400 を返す', async () => {
      const app = createApp();
      const res = await request(app).post('/api/ai/decompose-feedback').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch('feedbackHistory');
    });

    test('空配列のとき 400 を返す', async () => {
      const app = createApp();
      const res = await request(app).post('/api/ai/decompose-feedback').send({ feedbackHistory: [] });
      expect(res.status).toBe(400);
    });

    test('正常にフィードバックを分解できる', async () => {
      mockGenerateTweets.mockResolvedValue({
        provider: 'claude',
        candidates: [{ text: '{"rules":[{"text":"カジュアルな表現を使う","category":"tone"},{"text":"数字を含める","category":"content"}]}', hashtags: [] }]
      });

      const app = createApp();
      const res = await request(app).post('/api/ai/decompose-feedback').send({
        feedbackHistory: ['もっとカジュアルに', '数字を入れて'],
        provider: 'claude'
      });
      expect(res.status).toBe(200);
      expect(res.body.rules).toHaveLength(2);
      expect(res.body.rules[0].text).toBe('カジュアルな表現を使う');
      expect(res.body.rules[0].category).toBe('tone');
    });
  });

  describe('GET /api/ai/prompt-rules', () => {
    test('ルール一覧を取得できる', async () => {
      const rules = [
        { id: 1, rule_text: 'カジュアルに', category: 'tone', enabled: true },
        { id: 2, rule_text: '数字を含める', category: 'content', enabled: true }
      ];
      // Override the chain to return data for this test
      mockChain.order.mockReturnValueOnce({ data: rules, error: null });

      const app = createApp();
      const res = await request(app).get('/api/ai/prompt-rules');
      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/ai/prompt-rules', () => {
    test('rules が無いとき 400 を返す', async () => {
      const app = createApp();
      const res = await request(app).post('/api/ai/prompt-rules').send({ accountId: 1 });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch('rules');
    });

    test('accountId が無いとき 400 を返す', async () => {
      const app = createApp();
      const res = await request(app).post('/api/ai/prompt-rules').send({ rules: [{ text: 'test' }] });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch('accountId');
    });

    test('正常にルールを保存できる', async () => {
      const savedRules = [
        { id: 1, account_id: 1, rule_text: 'カジュアルに', category: 'tone', enabled: true }
      ];
      mockChain.select.mockResolvedValueOnce({ data: savedRules, error: null });

      const app = createApp();
      const res = await request(app).post('/api/ai/prompt-rules').send({
        rules: [{ text: 'カジュアルに', category: 'tone' }],
        accountId: 1
      });
      expect(res.status).toBe(200);
    });
  });

  describe('PUT /api/ai/prompt-rules/:id', () => {
    test('更新フィールドが無いとき 400 を返す', async () => {
      const app = createApp();
      const res = await request(app).put('/api/ai/prompt-rules/1').send({});
      expect(res.status).toBe(400);
    });

    test('enabled を更新できる', async () => {
      mockChain.select.mockResolvedValueOnce({
        data: [{ id: 1, enabled: false }],
        error: null
      });

      const app = createApp();
      const res = await request(app).put('/api/ai/prompt-rules/1').send({ enabled: false });
      expect(res.status).toBe(200);
    });
  });

  describe('DELETE /api/ai/prompt-rules/:id', () => {
    test('ルールを削除できる', async () => {
      mockChain.select.mockResolvedValueOnce({
        data: [{ id: 1 }],
        error: null
      });

      const app = createApp();
      const res = await request(app).delete('/api/ai/prompt-rules/1');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});
