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
const mockLogInfo = jest.fn().mockResolvedValue();
const mockLogError = jest.fn().mockResolvedValue();
const mockCleanOldLogs = jest.fn().mockResolvedValue();

jest.mock('../../server/services/scheduler', () => ({
  processScheduledPosts: mockProcessScheduledPosts
}));
jest.mock('../../server/services/auto-poster', () => ({
  checkAndRunAutoPosts: mockCheckAndRunAutoPosts
}));
jest.mock('../../server/services/app-logger', () => ({
  logInfo: mockLogInfo,
  logError: mockLogError,
  cleanOldLogs: mockCleanOldLogs
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
    test('認証成功時に checkAndRunAutoPosts と processScheduledPosts の両方を呼び出す', async () => {
      const { req, res } = createMockReqRes();
      await handlers['/scheduled'](req, res);
      expect(mockCheckAndRunAutoPosts).toHaveBeenCalledTimes(1);
      expect(mockProcessScheduledPosts).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    });

    test('成功時に開始・完了ログを記録する', async () => {
      const { req, res } = createMockReqRes();
      await handlers['/scheduled'](req, res);
      expect(mockLogInfo).toHaveBeenCalledWith('cron', 'Cron /scheduled 実行開始');
      expect(mockLogInfo).toHaveBeenCalledWith('cron', 'Cron /scheduled 実行完了');
    });

    test('古いログのクリーンアップを実行する', async () => {
      const { req, res } = createMockReqRes();
      await handlers['/scheduled'](req, res);
      expect(mockCleanOldLogs).toHaveBeenCalledWith(30);
    });

    test('cleanOldLogs がエラーでも処理は続行する', async () => {
      mockCleanOldLogs.mockRejectedValueOnce(new Error('cleanup failed'));
      const { req, res } = createMockReqRes();
      await handlers['/scheduled'](req, res);
      expect(mockProcessScheduledPosts).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    });

    test('CRON_SECRET 設定時に認証なしでは処理を呼ばない', async () => {
      process.env.CRON_SECRET = 'secret';
      const { req, res } = createMockReqRes();
      await handlers['/scheduled'](req, res);
      expect(mockProcessScheduledPosts).not.toHaveBeenCalled();
      expect(mockCheckAndRunAutoPosts).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('checkAndRunAutoPosts がエラーでも processScheduledPosts は続行する', async () => {
      mockCheckAndRunAutoPosts.mockRejectedValueOnce(new Error('auto-post failed'));
      const { req, res } = createMockReqRes();
      await handlers['/scheduled'](req, res);
      expect(mockProcessScheduledPosts).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
      expect(mockLogError).toHaveBeenCalledWith('cron', 'Cron /scheduled 内の自動投稿でエラー（続行）', expect.any(Object));
    });

    test('processScheduledPosts がエラーの場合は 500 を返しエラーログを記録する', async () => {
      const err = new Error('DB connection failed');
      mockProcessScheduledPosts.mockRejectedValueOnce(err);
      const { req, res } = createMockReqRes();
      await handlers['/scheduled'](req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'DB connection failed' });
      expect(mockLogError).toHaveBeenCalledWith('cron', 'Cron /scheduled 実行エラー', { error: 'DB connection failed', stack: err.stack });
    });
  });

  describe('/auto-post handler', () => {
    test('認証成功時に checkAndRunAutoPosts を呼び出す', async () => {
      const { req, res } = createMockReqRes();
      await handlers['/auto-post'](req, res);
      expect(mockCheckAndRunAutoPosts).toHaveBeenCalledTimes(1);
      expect(res.json).toHaveBeenCalledWith({ ok: true });
    });

    test('成功時に開始・完了ログを記録する', async () => {
      const { req, res } = createMockReqRes();
      await handlers['/auto-post'](req, res);
      expect(mockLogInfo).toHaveBeenCalledWith('cron', 'Cron /auto-post 実行開始');
      expect(mockLogInfo).toHaveBeenCalledWith('cron', 'Cron /auto-post 実行完了');
    });

    test('CRON_SECRET 設定時に認証なしでは checkAndRunAutoPosts を呼ばない', async () => {
      process.env.CRON_SECRET = 'secret';
      const { req, res } = createMockReqRes();
      await handlers['/auto-post'](req, res);
      expect(mockCheckAndRunAutoPosts).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
    });

    test('checkAndRunAutoPosts がエラーの場合は 500 を返しエラーログを記録する', async () => {
      const err = new Error('API rate limit');
      mockCheckAndRunAutoPosts.mockRejectedValueOnce(err);
      const { req, res } = createMockReqRes();
      await handlers['/auto-post'](req, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({ error: 'API rate limit' });
      expect(mockLogError).toHaveBeenCalledWith('cron', 'Cron /auto-post 実行エラー', { error: 'API rate limit', stack: err.stack });
    });
  });
});
