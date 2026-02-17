const express = require('express');

// Mock database
jest.mock('../../server/db/database', () => {
  const mockChain = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: { id: 'test-id' }, error: null }),
  };
  return {
    getDb: jest.fn(() => ({
      from: jest.fn(() => mockChain)
    }))
  };
});

// Mock X API
jest.mock('../../server/services/x-api', () => ({
  postTweet: jest.fn().mockResolvedValue({ data: { id: '12345' } })
}));

const tweetsRouter = require('../../server/routes/tweets');
const { postTweet } = require('../../server/services/x-api');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tweets', tweetsRouter);
  return app;
}

// Inline supertest-like helper using native http
const http = require('http');

function request(app) {
  const server = http.createServer(app);

  return {
    post(path) {
      return new RequestBuilder(server, 'POST', path);
    },
    get(path) {
      return new RequestBuilder(server, 'GET', path);
    },
    delete(path) {
      return new RequestBuilder(server, 'DELETE', path);
    },
    put(path) {
      return new RequestBuilder(server, 'PUT', path);
    }
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

  send(body) {
    this._body = body;
    return this;
  }

  set(header, value) {
    this._headers[header] = value;
    return this;
  }

  then(resolve, reject) {
    return this._execute().then(resolve, reject);
  }

  _execute() {
    return new Promise((resolve, reject) => {
      this._server.listen(0, () => {
        const port = this._server.address().port;
        const bodyStr = this._body ? JSON.stringify(this._body) : '';

        const options = {
          hostname: '127.0.0.1',
          port,
          path: this._path,
          method: this._method,
          headers: {
            ...this._headers,
            'Content-Length': Buffer.byteLength(bodyStr)
          }
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

        req.on('error', (err) => {
          this._server.close();
          reject(err);
        });

        if (bodyStr) req.write(bodyStr);
        req.end();
      });
    });
  }
}

describe('tweets routes', () => {
  describe('POST /api/tweets', () => {
    test('text が未指定の場合は 400 エラー', async () => {
      const app = createApp();
      const res = await request(app).post('/api/tweets').send({ accountId: 'acc-1' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('text is required');
    });

    test('accountId が未指定の場合は 400 エラー', async () => {
      const app = createApp();
      const res = await request(app).post('/api/tweets').send({ text: 'test tweet' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('accountId is required');
    });

    test('正常なツイート投稿は posted を返す', async () => {
      const app = createApp();
      const res = await request(app).post('/api/tweets').send({
        text: 'Hello world!',
        accountId: 'acc-1'
      });
      expect(res.status).toBe(200);
      expect(res.body.tweet_id).toBe('12345');
      expect(res.body.status).toBe('posted');
    });

    test('scheduledAt が指定された場合は scheduled を返す', async () => {
      const app = createApp();
      const scheduledAt = '2026-03-01T09:00:00.000Z';
      const res = await request(app).post('/api/tweets').send({
        text: 'Scheduled tweet',
        accountId: 'acc-1',
        scheduledAt
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('scheduled');
    });
  });

  describe('POST /api/tweets/reply', () => {
    test('text と targetTweetId が必須', async () => {
      const app = createApp();
      const res = await request(app).post('/api/tweets/reply').send({
        text: 'reply text',
        accountId: 'acc-1'
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('text and targetTweetId are required');
    });

    test('accountId が必須', async () => {
      const app = createApp();
      const res = await request(app).post('/api/tweets/reply').send({
        text: 'reply text',
        targetTweetId: 'tweet-123'
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('accountId is required');
    });
  });

  describe('POST /api/tweets/quote', () => {
    test('text と targetTweetId が必須', async () => {
      const app = createApp();
      const res = await request(app).post('/api/tweets/quote').send({
        text: 'quote text',
        accountId: 'acc-1'
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('text and targetTweetId are required');
    });

    test('accountId が必須', async () => {
      const app = createApp();
      const res = await request(app).post('/api/tweets/quote').send({
        text: 'quote text',
        targetTweetId: 'tweet-123'
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('accountId is required');
    });
  });

  describe('POST /api/tweets/schedule', () => {
    test('text と scheduledAt が必須', async () => {
      const app = createApp();
      const res = await request(app).post('/api/tweets/schedule').send({
        accountId: 'acc-1'
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('text and scheduledAt are required');
    });

    test('accountId が必須', async () => {
      const app = createApp();
      const res = await request(app).post('/api/tweets/schedule').send({
        text: 'scheduled tweet',
        scheduledAt: '2026-03-01T09:00:00.000Z'
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('accountId is required');
    });

    test('正常なスケジュール登録', async () => {
      const app = createApp();
      const res = await request(app).post('/api/tweets/schedule').send({
        text: 'scheduled tweet',
        accountId: 'acc-1',
        scheduledAt: '2026-03-01T09:00:00.000Z'
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('scheduled');
    });
  });

  describe('PUT /api/tweets/scheduled/:id', () => {
    test('更新フィールドがない場合は 400 エラー', async () => {
      const app = createApp();
      const res = await request(app).put('/api/tweets/scheduled/123').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('No fields to update');
    });
  });
});
