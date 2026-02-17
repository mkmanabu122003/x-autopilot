const express = require('express');
const http = require('http');

// ---- Mock setup ----
// Variables prefixed with 'mock' are allowed in jest.mock() factory
let mockTableConfigs = {};

function mockCreateChain(tableConfig) {
  const chain = {};
  const resolve = () => {
    if (tableConfig && tableConfig._result) {
      return Promise.resolve(tableConfig._result);
    }
    return Promise.resolve({ data: null, error: null });
  };

  chain.select = jest.fn(() => chain);
  chain.insert = jest.fn(() => chain);
  chain.update = jest.fn(() => chain);
  chain.delete = jest.fn(() => chain);
  chain.eq = jest.fn(() => chain);
  chain.in = jest.fn(() => chain);
  chain.order = jest.fn(() => chain);
  chain.limit = jest.fn(() => chain);
  chain.single = jest.fn(() => {
    if (tableConfig && tableConfig._single !== undefined) {
      return Promise.resolve({ data: tableConfig._single, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  });
  chain.then = (onResolve, onReject) => {
    return resolve().then(onResolve, onReject);
  };
  return chain;
}

jest.mock('../../server/db/database', () => ({
  getDb: jest.fn(() => ({
    from: jest.fn((table) => mockCreateChain(mockTableConfigs[table]))
  }))
}));

jest.mock('../../server/services/x-api', () => ({
  getUserByHandle: jest.fn(),
  getUserTweets: jest.fn(),
  searchRecentTweets: jest.fn(),
}));

jest.mock('../../server/services/analytics', () => ({
  calculateEngagementRate: jest.fn(() => 0),
}));

jest.mock('../../server/services/scheduler', () => ({
  fetchAllCompetitorTweets: jest.fn(),
}));

jest.mock('../../server/services/ai-provider', () => ({
  getAIProvider: jest.fn(),
  AIProvider: jest.fn().mockImplementation(() => ({
    getTaskModelSettings: jest.fn().mockResolvedValue({}),
  })),
}));

const mockFetch = jest.fn();
global.fetch = mockFetch;

const { getUserByHandle } = require('../../server/services/x-api');

function request(app) {
  const server = http.createServer(app);
  return {
    post(path) { return new RequestBuilder(server, 'POST', path); },
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
  then(resolve, reject) { return this._execute().then(resolve, reject); }
  _execute() {
    return new Promise((resolve, reject) => {
      this._server.listen(0, () => {
        const port = this._server.address().port;
        const bodyStr = this._body ? JSON.stringify(this._body) : '';
        const options = {
          hostname: '127.0.0.1', port,
          path: this._path, method: this._method,
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

function createApp() {
  const competitorsRouter = require('../../server/routes/competitors');
  const app = express();
  app.use(express.json());
  app.use('/api/competitors', competitorsRouter);
  return app;
}

describe('competitors routes - suggest-keywords', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTableConfigs = {};
    delete process.env.CLAUDE_API_KEY;
    delete process.env.GEMINI_API_KEY;
  });

  test('accountId が未指定の場合は 400 エラー', async () => {
    const app = createApp();
    const res = await request(app).post('/api/competitors/suggest-keywords').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('accountId is required');
  });

  test('AIプロバイダー未設定時はdebugメッセージを返す', async () => {
    mockTableConfigs = {
      x_accounts: { _single: { handle: 'testuser', display_name: 'Test User', default_ai_provider: 'claude', default_ai_model: '' } },
      competitors: { _single: null, _result: { data: [], error: null } },
      settings: { _single: null },
    };

    const app = createApp();
    const res = await request(app).post('/api/competitors/suggest-keywords').send({ accountId: 1 });
    expect(res.status).toBe(200);
    expect(res.body.debug).toContain('AIプロバイダーのAPIキーが設定されていません');
  });

  test('プロフィール情報がある場合、プロンプトにプロフィールが含まれる', async () => {
    process.env.CLAUDE_API_KEY = 'test-key';

    mockTableConfigs = {
      x_accounts: { _single: { handle: 'testuser', display_name: 'Test User', default_ai_provider: 'claude', default_ai_model: '' } },
      competitors: { _single: null, _result: { data: [], error: null } },
      my_posts: { _result: { data: [], error: null } },
      settings: { _single: null },
    };

    getUserByHandle.mockResolvedValue({
      data: { id: '123', description: 'Web開発者 | React/Node.js' }
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        content: [{ text: '["Web開発", "React", "Node.js", "フロントエンド", "JavaScript"]' }]
      })
    });

    const app = createApp();
    const res = await request(app).post('/api/competitors/suggest-keywords').send({ accountId: 1 });
    expect(res.status).toBe(200);

    // Verify the prompt sent to AI contains profile text
    expect(mockFetch).toHaveBeenCalled();
    const fetchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.messages[0].content).toContain('Web開発者');
    expect(body.messages[0].content).toContain('React/Node.js');

    // Verify suggestions are returned
    expect(res.body.profile).toEqual(['Web開発', 'React', 'Node.js', 'フロントエンド', 'JavaScript']);
  });

  test('プロフィール・ツイートなしの場合、推測でキーワードを生成しないプロンプトが送信される', async () => {
    process.env.CLAUDE_API_KEY = 'test-key';

    mockTableConfigs = {
      x_accounts: { _single: { handle: 'konpota37876', display_name: 'こんぽた', default_ai_provider: 'claude', default_ai_model: '' } },
      competitors: { _single: null, _result: { data: [], error: null } },
      my_posts: { _result: { data: [], error: null } },
      settings: { _single: null },
    };

    getUserByHandle.mockRejectedValue(new Error('API error'));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        content: [{ text: '[]' }]
      })
    });

    const app = createApp();
    const res = await request(app).post('/api/competitors/suggest-keywords').send({ accountId: 1 });
    expect(res.status).toBe(200);

    // Verify prompt instructs AI not to guess
    expect(mockFetch).toHaveBeenCalled();
    const fetchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    const promptText = body.messages[0].content;
    expect(promptText).toContain('（プロフィール情報なし）');
    expect(promptText).toContain('（ツイートデータなし）');
    expect(promptText).toContain('空の配列 [] を返すこと');
    expect(promptText).toContain('推測で含めないこと');
    // Must NOT contain the old rule about guessing from handle/name
    expect(promptText).not.toContain('情報が少ない場合でも、アカウント名やハンドル名から推測して提案すること');
  });

  test('プロフィール・ツイートなしで空配列が返された場合、適切なdebugメッセージを返す', async () => {
    process.env.CLAUDE_API_KEY = 'test-key';

    mockTableConfigs = {
      x_accounts: { _single: { handle: 'konpota37876', display_name: 'こんぽた', default_ai_provider: 'claude', default_ai_model: '' } },
      competitors: { _single: null, _result: { data: [], error: null } },
      my_posts: { _result: { data: [], error: null } },
      settings: { _single: null },
    };

    getUserByHandle.mockRejectedValue(new Error('API error'));

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        content: [{ text: '[]' }]
      })
    });

    const app = createApp();
    const res = await request(app).post('/api/competitors/suggest-keywords').send({ accountId: 1 });
    expect(res.status).toBe(200);
    expect(res.body.profile).toEqual([]);
    expect(res.body.debug).toContain('プロフィールやツイートのデータが取得できなかった');
  });

  test('competitorsテーブルにユーザーが存在してもX APIからプロフィールを取得する', async () => {
    process.env.CLAUDE_API_KEY = 'test-key';

    mockTableConfigs = {
      x_accounts: { _single: { handle: 'testuser', display_name: 'Test User', default_ai_provider: 'claude', default_ai_model: '' } },
      competitors: { _single: { user_id: '123', name: 'Test User' }, _result: { data: [], error: null } },
      my_posts: { _result: { data: [], error: null } },
      settings: { _single: null },
    };

    getUserByHandle.mockResolvedValue({
      data: { id: '123', description: 'プログラミング講師 | Python/AI' }
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        content: [{ text: '["Python", "AI", "プログラミング教育", "機械学習", "データサイエンス"]' }]
      })
    });

    const app = createApp();
    const res = await request(app).post('/api/competitors/suggest-keywords').send({ accountId: 1 });
    expect(res.status).toBe(200);

    // getUserByHandle should be called even though user was in competitors table
    expect(getUserByHandle).toHaveBeenCalled();

    // Verify prompt contains profile
    expect(mockFetch).toHaveBeenCalled();
    const fetchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.messages[0].content).toContain('プログラミング講師');
  });
});
