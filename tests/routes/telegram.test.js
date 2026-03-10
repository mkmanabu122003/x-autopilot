// Mock telegram-workflow
const mockTriggerTweetProposal = jest.fn();
jest.mock('../../server/services/telegram-workflow', () => ({
  triggerTweetProposal: mockTriggerTweetProposal
}));

// Mock telegram-bot
const mockGetBot = jest.fn();
const mockSendNotification = jest.fn();
jest.mock('../../server/services/telegram-bot', () => ({
  getBot: mockGetBot,
  sendNotification: mockSendNotification
}));

const express = require('express');
const telegramRouter = require('../../server/routes/telegram');

// Set up test app
const app = express();
app.use(express.json());
app.use('/api/telegram', telegramRouter);

// Simple supertest alternative using node http
const http = require('http');
let server;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: server.address().port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe('telegram routes', () => {
  beforeAll((done) => {
    server = app.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TELEGRAM_CHAT_ID = '12345';
  });

  afterEach(() => {
    delete process.env.TELEGRAM_CHAT_ID;
  });

  describe('POST /api/telegram/trigger', () => {
    test('should trigger tweet proposal', async () => {
      mockTriggerTweetProposal.mockResolvedValue({ generated: 3, postIds: ['p1', 'p2', 'p3'] });

      const res = await request('POST', '/api/telegram/trigger', {
        accountId: 'account-1',
        theme: 'AI',
        postType: 'new'
      });

      expect(res.status).toBe(200);
      expect(res.body.generated).toBe(3);
      expect(mockTriggerTweetProposal).toHaveBeenCalledWith('account-1', {
        theme: 'AI',
        postType: 'new',
        aiProvider: undefined,
        aiModel: undefined
      });
    });

    test('should return 400 when accountId is missing', async () => {
      const res = await request('POST', '/api/telegram/trigger', { theme: 'test' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('accountId');
    });

    test('should return 500 on error', async () => {
      mockTriggerTweetProposal.mockRejectedValue(new Error('Generation failed'));

      const res = await request('POST', '/api/telegram/trigger', {
        accountId: 'account-1'
      });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Generation failed');
    });
  });

  describe('GET /api/telegram/status', () => {
    test('should return connected status when bot is running', async () => {
      mockGetBot.mockReturnValue({
        getMe: jest.fn().mockResolvedValue({
          id: 123,
          username: 'test_bot',
          first_name: 'Test Bot'
        })
      });

      const res = await request('GET', '/api/telegram/status');
      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(true);
      expect(res.body.bot.username).toBe('test_bot');
    });

    test('should return disconnected status when bot is not initialized', async () => {
      mockGetBot.mockReturnValue(null);

      const res = await request('GET', '/api/telegram/status');
      expect(res.status).toBe(200);
      expect(res.body.connected).toBe(false);
    });
  });

  describe('POST /api/telegram/test', () => {
    test('should send test notification', async () => {
      mockSendNotification.mockResolvedValue({ message_id: 300 });

      const res = await request('POST', '/api/telegram/test', {});
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockSendNotification).toHaveBeenCalledWith('12345',
        expect.stringContaining('テスト通知'));
    });

    test('should return 400 when no chatId available', async () => {
      delete process.env.TELEGRAM_CHAT_ID;
      const res = await request('POST', '/api/telegram/test', {});
      expect(res.status).toBe(400);
    });

    test('should return 500 when bot is not initialized', async () => {
      mockSendNotification.mockResolvedValue(null);
      const res = await request('POST', '/api/telegram/test', {});
      expect(res.status).toBe(500);
    });
  });
});
