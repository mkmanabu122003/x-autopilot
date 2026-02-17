const express = require('express');
const http = require('http');

// Mock database - Supabase-like chainable query builder
const mockChain = {};
const mockUpsert = jest.fn();
const mockSelect = jest.fn(() => mockChain);
const mockUpdate = jest.fn(() => mockChain);
const mockInsert = jest.fn(() => mockChain);
const mockDelete = jest.fn(() => mockChain);
const mockEq = jest.fn(() => mockChain);
const mockOrder = jest.fn(() => mockChain);
const mockLimit = jest.fn(() => mockChain);
const mockSingle = jest.fn();

Object.assign(mockChain, {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  upsert: mockUpsert,
  delete: mockDelete,
  eq: mockEq,
  order: mockOrder,
  limit: mockLimit,
  single: mockSingle,
  then: jest.fn((resolve) => resolve({ data: null, error: null })),
});

const mockFrom = jest.fn(() => mockChain);

jest.mock('../../server/db/database', () => ({
  getDb: jest.fn(() => ({ from: mockFrom }))
}));

jest.mock('../../server/services/auto-poster', () => ({
  runAutoPostManually: jest.fn()
}));

const autoPostRouter = require('../../server/routes/auto-post');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auto-post', autoPostRouter);
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

describe('auto-post routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelect.mockImplementation(() => mockChain);
    mockEq.mockImplementation(() => mockChain);
    mockOrder.mockImplementation(() => mockChain);
    mockLimit.mockImplementation(() => mockChain);
    mockUpdate.mockImplementation(() => mockChain);
    mockInsert.mockImplementation(() => mockChain);
    mockDelete.mockImplementation(() => mockChain);
    mockSingle.mockResolvedValue({ data: null, error: null });
    mockUpsert.mockImplementation(() => mockChain);
    mockChain.then = jest.fn((resolve) => resolve({ data: null, error: null }));
  });

  describe('GET /api/auto-post/settings', () => {
    test('アカウントIDで設定を取得する', async () => {
      // Chain: from().select().order().eq() → await resolves via mockChain.then
      mockChain.then = jest.fn((resolve) => resolve({
        data: [
          { id: 1, account_id: 1, post_type: 'new', enabled: true, posts_per_day: 3, schedule_times: '09:00', x_accounts: { display_name: 'Test', handle: '@test' } },
          { id: 2, account_id: 1, post_type: 'reply', enabled: false, posts_per_day: 2, schedule_times: '10:00,13:00', x_accounts: { display_name: 'Test', handle: '@test' } },
        ],
        error: null
      }));

      const app = createApp();
      const res = await request(app).get('/api/auto-post/settings?accountId=1');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].account_name).toBe('Test');
      expect(res.body[0].account_handle).toBe('@test');
      expect(res.body[0].x_accounts).toBeUndefined();
    });

    test('DB エラー時は 500 を返す', async () => {
      mockChain.then = jest.fn((resolve) => resolve({
        data: null,
        error: new Error('DB connection failed')
      }));

      const app = createApp();
      const res = await request(app).get('/api/auto-post/settings?accountId=1');
      expect(res.status).toBe(500);
      expect(res.body.error).toBeDefined();
    });
  });

  describe('PUT /api/auto-post/settings', () => {
    test('設定を正常に保存できる', async () => {
      mockSingle.mockResolvedValueOnce({ data: { id: 1 }, error: null });
      mockUpsert.mockImplementationOnce(() => ({ ...mockChain, select: () => ({ single: mockSingle }) }));

      const app = createApp();
      const res = await request(app).put('/api/auto-post/settings').send({
        accountId: 1,
        postType: 'reply',
        enabled: true,
        postsPerDay: 2,
        scheduleTimes: '10:00,13:00',
        scheduleMode: 'immediate',
        themes: '',
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.id).toBe(1);
    });

    test('accountId がない場合 400 を返す', async () => {
      const app = createApp();
      const res = await request(app).put('/api/auto-post/settings').send({
        postType: 'reply',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('accountId');
    });

    test('postType がない場合 400 を返す', async () => {
      const app = createApp();
      const res = await request(app).put('/api/auto-post/settings').send({
        accountId: 1,
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('postType');
    });

    test('不正な postType は 400 を返す', async () => {
      const app = createApp();
      const res = await request(app).put('/api/auto-post/settings').send({
        accountId: 1,
        postType: 'invalid',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('postType');
    });

    test('不正な時刻フォーマットは 400 を返す', async () => {
      const app = createApp();
      const res = await request(app).put('/api/auto-post/settings').send({
        accountId: 1,
        postType: 'reply',
        scheduleTimes: '10:00,invalid',
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Invalid time format');
    });

    test('upsert エラー時は 500 を返す', async () => {
      mockSingle.mockResolvedValueOnce({ data: null, error: new Error('upsert failed') });
      mockUpsert.mockImplementationOnce(() => ({ ...mockChain, select: () => ({ single: mockSingle }) }));

      const app = createApp();
      const res = await request(app).put('/api/auto-post/settings').send({
        accountId: 1,
        postType: 'reply',
        enabled: true,
        postsPerDay: 2,
        scheduleTimes: '10:00',
      });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('upsert failed');
    });
  });

  describe('GET /api/auto-post/logs', () => {
    test('実行ログを取得する', async () => {
      // Chain: from().select().order().limit().eq() → await resolves via mockChain.then
      mockChain.then = jest.fn((resolve) => resolve({
        data: [
          { id: 1, account_id: 1, post_type: 'reply', posts_generated: 2, status: 'success', executed_at: '2026-02-17T10:00:00Z', x_accounts: { display_name: 'Test', handle: '@test' } },
        ],
        error: null
      }));

      const app = createApp();
      const res = await request(app).get('/api/auto-post/logs?accountId=1&limit=10');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].account_name).toBe('Test');
      expect(res.body[0].x_accounts).toBeUndefined();
    });
  });
});
