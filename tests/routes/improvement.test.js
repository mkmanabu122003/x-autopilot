const express = require('express');
const http = require('http');

// Mock tweet-improver service
const mockAnalyzePostPerformance = jest.fn();
const mockGenerateImprovementInsights = jest.fn();
const mockGetLatestAnalysis = jest.fn();
const mockGetAnalysisHistory = jest.fn();
const mockAutoAdjustSettings = jest.fn();

jest.mock('../../server/services/tweet-improver', () => ({
  analyzePostPerformance: mockAnalyzePostPerformance,
  generateImprovementInsights: mockGenerateImprovementInsights,
  getLatestAnalysis: mockGetLatestAnalysis,
  getAnalysisHistory: mockGetAnalysisHistory,
  autoAdjustSettings: mockAutoAdjustSettings
}));

const improvementRouter = require('../../server/routes/improvement');

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/improvement', improvementRouter);
  return app;
}

// Inline supertest-like helper using native http
function request(app) {
  const server = http.createServer(app);
  return {
    get(path) { return new RequestBuilder(server, 'GET', path); },
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

describe('improvement routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/improvement/analysis', () => {
    test('最新の分析結果を返す', async () => {
      const analysisData = {
        id: 1,
        account_id: 1,
        post_count: 10,
        avg_engagement_rate: 3.5,
        suggestions: [{ category: 'content', title: 'テスト' }],
        created_at: '2026-02-01T00:00:00Z'
      };
      mockGetLatestAnalysis.mockResolvedValue(analysisData);

      const app = createApp();
      const res = await request(app).get('/api/improvement/analysis?accountId=1');
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(1);
      expect(res.body.post_count).toBe(10);
    });

    test('分析がない場合は no_data ステータスを返す', async () => {
      mockGetLatestAnalysis.mockResolvedValue(null);

      const app = createApp();
      const res = await request(app).get('/api/improvement/analysis');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('no_data');
    });

    test('エラー時は 500 を返す', async () => {
      mockGetLatestAnalysis.mockRejectedValue(new Error('DB error'));

      const app = createApp();
      const res = await request(app).get('/api/improvement/analysis');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('DB error');
    });
  });

  describe('GET /api/improvement/history', () => {
    test('分析履歴を返す', async () => {
      const historyData = [
        { id: 1, post_count: 10, avg_engagement_rate: 3.5, created_at: '2026-02-01T00:00:00Z' },
        { id: 2, post_count: 15, avg_engagement_rate: 4.0, created_at: '2026-02-08T00:00:00Z' }
      ];
      mockGetAnalysisHistory.mockResolvedValue(historyData);

      const app = createApp();
      const res = await request(app).get('/api/improvement/history?accountId=1');
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
    });

    test('limit パラメータが上限50に制限される', async () => {
      mockGetAnalysisHistory.mockResolvedValue([]);

      const app = createApp();
      await request(app).get('/api/improvement/history?limit=100');
      expect(mockGetAnalysisHistory).toHaveBeenCalledWith(undefined, 50);
    });
  });

  describe('POST /api/improvement/analyze', () => {
    test('分析を実行して結果を返す', async () => {
      const result = {
        status: 'ok',
        analysisId: 1,
        analysis: { postCount: 10 },
        suggestions: [{ category: 'content', title: 'テスト' }]
      };
      mockGenerateImprovementInsights.mockResolvedValue(result);

      const app = createApp();
      const res = await request(app).post('/api/improvement/analyze').send({ accountId: 1, provider: 'claude' });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(mockGenerateImprovementInsights).toHaveBeenCalledWith(1, 'claude', undefined);
    });

    test('model パラメータを指定して分析を実行する', async () => {
      const result = {
        status: 'ok',
        analysisId: 2,
        analysis: { postCount: 10 },
        suggestions: [{ category: 'content', title: 'テスト' }]
      };
      mockGenerateImprovementInsights.mockResolvedValue(result);

      const app = createApp();
      const res = await request(app).post('/api/improvement/analyze').send({
        accountId: 1,
        provider: 'claude',
        model: 'claude-haiku-4-5-20251001'
      });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(mockGenerateImprovementInsights).toHaveBeenCalledWith(1, 'claude', 'claude-haiku-4-5-20251001');
    });

    test('データ不足時は insufficient_data ステータスを返す', async () => {
      mockGenerateImprovementInsights.mockResolvedValue({
        status: 'insufficient_data',
        message: '分析には最低5件のデータが必要です',
        suggestions: []
      });

      const app = createApp();
      const res = await request(app).post('/api/improvement/analyze').send({ accountId: 1 });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('insufficient_data');
    });

    test('エラー時は 500 を返す', async () => {
      mockGenerateImprovementInsights.mockRejectedValue(new Error('AI error'));

      const app = createApp();
      const res = await request(app).post('/api/improvement/analyze').send({ accountId: 1 });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('AI error');
    });
  });

  describe('POST /api/improvement/auto-adjust', () => {
    test('設定を自動調整して結果を返す', async () => {
      mockAutoAdjustSettings.mockResolvedValue({
        adjusted: true,
        adjustments: [
          { type: 'schedule_times', from: '09:00', to: '12:00,18:00', reason: 'テスト' }
        ]
      });

      const app = createApp();
      const res = await request(app).post('/api/improvement/auto-adjust').send({ accountId: 1 });
      expect(res.status).toBe(200);
      expect(res.body.adjusted).toBe(true);
      expect(res.body.adjustments).toHaveLength(1);
    });

    test('accountId が未指定の場合は 400 を返す', async () => {
      const app = createApp();
      const res = await request(app).post('/api/improvement/auto-adjust').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('accountId is required');
    });

    test('調整不要の場合は adjusted: false を返す', async () => {
      mockAutoAdjustSettings.mockResolvedValue({
        adjusted: false,
        adjustments: []
      });

      const app = createApp();
      const res = await request(app).post('/api/improvement/auto-adjust').send({ accountId: 1 });
      expect(res.status).toBe(200);
      expect(res.body.adjusted).toBe(false);
    });
  });

  describe('GET /api/improvement/performance', () => {
    test('パフォーマンス分析結果を返す', async () => {
      const perfData = {
        status: 'ok',
        postCount: 15,
        overallStats: { avgEngagementRate: 4.2 }
      };
      mockAnalyzePostPerformance.mockResolvedValue(perfData);

      const app = createApp();
      const res = await request(app).get('/api/improvement/performance?accountId=1');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.postCount).toBe(15);
    });

    test('エラー時は 500 を返す', async () => {
      mockAnalyzePostPerformance.mockRejectedValue(new Error('DB error'));

      const app = createApp();
      const res = await request(app).get('/api/improvement/performance');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('DB error');
    });
  });
});
