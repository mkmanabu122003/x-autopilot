const express = require('express');
const http = require('http');

// Mock app-logger
const mockGetLogs = jest.fn().mockResolvedValue([]);
const mockGetLogCount = jest.fn().mockResolvedValue(0);
const mockCleanOldLogs = jest.fn().mockResolvedValue(undefined);

jest.mock('../../server/services/app-logger', () => ({
  getLogs: (...args) => mockGetLogs(...args),
  getLogCount: (...args) => mockGetLogCount(...args),
  cleanOldLogs: (...args) => mockCleanOldLogs(...args),
  VALID_LEVELS: ['error', 'warn', 'info']
}));

const logsRouter = require('../../server/routes/logs');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/logs', logsRouter);
  return app;
}

// Inline supertest-like helper using native http
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

function request(app) {
  const server = http.createServer(app);
  return {
    get(path) { return new RequestBuilder(server, 'GET', path); },
    delete(path) { return new RequestBuilder(server, 'DELETE', path); },
  };
}

describe('logs routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLogs.mockResolvedValue([]);
    mockGetLogCount.mockResolvedValue(0);
    mockCleanOldLogs.mockResolvedValue(undefined);
  });

  describe('GET /api/logs', () => {
    test('ログ一覧を取得する', async () => {
      const mockLogs = [
        { id: 1, level: 'error', category: 'api', message: 'テストエラー', details: null, created_at: '2026-02-17T00:00:00Z' }
      ];
      mockGetLogs.mockResolvedValueOnce(mockLogs);
      mockGetLogCount.mockResolvedValueOnce(1);

      const app = createApp();
      const res = await request(app).get('/api/logs');

      expect(res.status).toBe(200);
      expect(res.body.logs).toEqual(mockLogs);
      expect(res.body.total).toBe(1);
      expect(res.body.limit).toBe(100);
      expect(res.body.offset).toBe(0);
    });

    test('levelフィルタが正しく渡される', async () => {
      const app = createApp();
      await request(app).get('/api/logs?level=error');

      expect(mockGetLogs).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'error' })
      );
      expect(mockGetLogCount).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'error' })
      );
    });

    test('categoryフィルタが正しく渡される', async () => {
      const app = createApp();
      await request(app).get('/api/logs?category=api');

      expect(mockGetLogs).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'api' })
      );
    });

    test('limit/offsetが正しく渡される', async () => {
      const app = createApp();
      await request(app).get('/api/logs?limit=50&offset=100');

      expect(mockGetLogs).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 50, offset: 100 })
      );
    });

    test('limitの上限は500', async () => {
      const app = createApp();
      await request(app).get('/api/logs?limit=1000');

      expect(mockGetLogs).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 500 })
      );
    });

    test('エラー時は500を返す', async () => {
      mockGetLogs.mockRejectedValueOnce(new Error('query failed'));

      const app = createApp();
      const res = await request(app).get('/api/logs');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('query failed');
    });
  });

  describe('DELETE /api/logs', () => {
    test('古いログを削除する', async () => {
      const app = createApp();
      const res = await request(app).delete('/api/logs');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockCleanOldLogs).toHaveBeenCalledWith(30);
    });

    test('保持日数を指定できる', async () => {
      const app = createApp();
      await request(app).delete('/api/logs?days=7');

      expect(mockCleanOldLogs).toHaveBeenCalledWith(7);
    });

    test('エラー時は500を返す', async () => {
      mockCleanOldLogs.mockRejectedValueOnce(new Error('delete failed'));

      const app = createApp();
      const res = await request(app).delete('/api/logs');

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('delete failed');
    });
  });
});
