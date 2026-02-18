// Mock express before requiring the module
jest.mock('express', () => {
  const handlers = {};
  const router = {
    get: jest.fn((path, handler) => { handlers[path] = handler; }),
  };
  router._handlers = handlers;
  return {
    Router: jest.fn(() => router),
    _router: router,
  };
}, { virtual: true });

// Mock scheduler and auto-poster
const mockProcessScheduledPosts = jest.fn().mockResolvedValue();
const mockCheckAndRunAutoPosts = jest.fn().mockResolvedValue();

jest.mock('../../server/services/scheduler', () => ({
  processScheduledPosts: mockProcessScheduledPosts
}));
jest.mock('../../server/services/auto-poster', () => ({
  checkAndRunAutoPosts: mockCheckAndRunAutoPosts
}));

const cronRouter = require('../../server/routes/cron');
const { _verifyCronSecret: verifyCronSecret } = cronRouter;

// Helper to create mock req/res
function createMockReqRes(headers = {}, query = {}) {
  const res = {
    statusCode: 200,
    body: null,
    status: jest.fn(function(code) { this.statusCode = code; return this; }),
    json: jest.fn(function(data) { this.body = data; return this; }),
  };
  const req = {
    headers,
    query,
  };
  return { req, res };
}

describe('verifyCronSecret', () => {
  beforeEach(() => {
    delete process.env.CRON_SECRET;
  });

  afterAll(() => {
    delete process.env.CRON_SECRET;
  });

  test('CRON_SECRET 未設定の場合は true を返す（dev モード）', () => {
    const { req, res } = createMockReqRes();
    expect(verifyCronSecret(req, res)).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('CRON_SECRET 設定時に正しいトークンで true を返す', () => {
    process.env.CRON_SECRET = 'my-secret-token';
    const { req, res } = createMockReqRes({ authorization: 'Bearer my-secret-token' });
    expect(verifyCronSecret(req, res)).toBe(true);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('CRON_SECRET 設定時に認証ヘッダーなしで false+401 を返す', () => {
    process.env.CRON_SECRET = 'my-secret-token';
    const { req, res } = createMockReqRes();
    expect(verifyCronSecret(req, res)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  test('CRON_SECRET 設定時に不正なトークンで false+401 を返す', () => {
    process.env.CRON_SECRET = 'my-secret-token';
    const { req, res } = createMockReqRes({ authorization: 'Bearer wrong-token' });
    expect(verifyCronSecret(req, res)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('?source=client パラメータだけでは認証をバイパスできない', () => {
    process.env.CRON_SECRET = 'my-secret-token';
    const { req, res } = createMockReqRes({}, { source: 'client' });
    expect(verifyCronSecret(req, res)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  test('Bearer プレフィックスなしのトークンは拒否される', () => {
    process.env.CRON_SECRET = 'my-secret-token';
    const { req, res } = createMockReqRes({ authorization: 'my-secret-token' });
    expect(verifyCronSecret(req, res)).toBe(false);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('cron route handlers', () => {
  const express = require('express');
  const handlers = express._router._handlers;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.CRON_SECRET;
  });

  afterAll(() => {
    delete process.env.CRON_SECRET;
  });

  describe('/scheduled handler', () => {
    test('認証成功時に processScheduledPosts を呼び出す', async () => {
      const { req, res } = createMockReqRes();
      await handlers['/scheduled'](req, res);
      expect(mockProcessScheduledPosts).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    });

    test('CRON_SECRET 設定時に認証なしでは processScheduledPosts を呼ばない', async () => {
      process.env.CRON_SECRET = 'secret';
      const { req, res } = createMockReqRes();
      await handlers['/scheduled'](req, res);
      expect(mockProcessScheduledPosts).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('processScheduledPosts がエラーの場合は 500 を返す', async () => {
      mockProcessScheduledPosts.mockRejectedValueOnce(new Error('DB connection failed'));
      const { req, res } = createMockReqRes();
      await handlers['/scheduled'](req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'DB connection failed' });
    });
  });

  describe('/auto-post handler', () => {
    test('認証成功時に checkAndRunAutoPosts を呼び出す', async () => {
      const { req, res } = createMockReqRes();
      await handlers['/auto-post'](req, res);
      expect(mockCheckAndRunAutoPosts).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    test('CRON_SECRET 設定時に認証なしでは checkAndRunAutoPosts を呼ばない', async () => {
      process.env.CRON_SECRET = 'secret';
      const { req, res } = createMockReqRes();
      await handlers['/auto-post'](req, res);
      expect(mockCheckAndRunAutoPosts).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('checkAndRunAutoPosts がエラーの場合は 500 を返す', async () => {
      mockCheckAndRunAutoPosts.mockRejectedValueOnce(new Error('API rate limit'));
      const { req, res } = createMockReqRes();
      await handlers['/auto-post'](req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'API rate limit' });
    });
  });
});
