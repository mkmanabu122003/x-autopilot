// Mock database
jest.mock('../../server/db/database', () => {
  const mockChain = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
  return {
    getDb: jest.fn(() => ({
      from: jest.fn(() => mockChain)
    }))
  };
});

// Mock x-api
jest.mock('../../server/services/x-api', () => ({
  postTweet: jest.fn().mockResolvedValue({ data: { id: 'tweet-123' } }),
  logApiUsage: jest.fn().mockResolvedValue(undefined)
}));

// Mock ai-provider
jest.mock('../../server/services/ai-provider', () => ({
  getAIProvider: jest.fn(() => ({
    generateTweets: jest.fn().mockResolvedValue({
      provider: 'claude',
      model: 'claude-sonnet-4-20250514',
      candidates: [{ text: 'テスト投稿', label: 'テスト', hashtags: [] }]
    })
  })),
  AIProvider: jest.fn().mockImplementation(() => ({
    getTaskModelSettings: jest.fn().mockResolvedValue({ preferredProvider: 'claude' })
  }))
}));

// Mock analytics
jest.mock('../../server/services/analytics', () => ({
  getQuoteSuggestions: jest.fn().mockResolvedValue([]),
  getReplySuggestions: jest.fn().mockResolvedValue([]),
  getCompetitorContext: jest.fn().mockResolvedValue('')
}));

// Mock cost-calculator
jest.mock('../../server/services/cost-calculator', () => ({
  logDetailedUsage: jest.fn().mockResolvedValue(undefined),
  checkBudgetStatus: jest.fn().mockResolvedValue({ shouldPause: false })
}));

const { logAutoPostExecution, isTimeInWindow, SCHEDULE_WINDOW_MINUTES } = require('../../server/services/auto-poster');
const { getDb } = require('../../server/db/database');

describe('auto-poster', () => {
  describe('isTimeInWindow', () => {
    test('完全一致はマッチする', () => {
      expect(isTimeInWindow('20:50', '20:50')).toBe(true);
    });

    test('ウィンドウ内（+1分）はマッチする', () => {
      expect(isTimeInWindow('20:50', '20:51')).toBe(true);
    });

    test('ウィンドウ内（+4分）はマッチする', () => {
      expect(isTimeInWindow('20:50', '20:54')).toBe(true);
    });

    test('ウィンドウ外（+5分）はマッチしない', () => {
      expect(isTimeInWindow('20:50', '20:55')).toBe(false);
    });

    test('設定時刻より前はマッチしない', () => {
      expect(isTimeInWindow('20:50', '20:49')).toBe(false);
    });

    test('大幅にずれている場合はマッチしない', () => {
      expect(isTimeInWindow('20:50', '21:00')).toBe(false);
    });

    test('深夜帯の時刻でも正しく動作する', () => {
      expect(isTimeInWindow('23:58', '23:59')).toBe(true);
    });

    test('深夜のラップアラウンド: 23:58設定で00:01はウィンドウ内', () => {
      expect(isTimeInWindow('23:58', '00:01')).toBe(true);
    });

    test('深夜のラップアラウンド: 23:58設定で00:05はウィンドウ外', () => {
      expect(isTimeInWindow('23:58', '00:05')).toBe(false);
    });

    test('カスタムウィンドウ幅を指定できる', () => {
      expect(isTimeInWindow('09:00', '09:09', 10)).toBe(true);
      expect(isTimeInWindow('09:00', '09:10', 10)).toBe(false);
    });

    test('09:08設定で09:10（cron-job.org 5分間隔）はマッチする', () => {
      expect(isTimeInWindow('09:08', '09:10')).toBe(true);
    });

    test('09:08設定で09:05はマッチしない（設定時刻より前）', () => {
      expect(isTimeInWindow('09:08', '09:05')).toBe(false);
    });

    test('SCHEDULE_WINDOW_MINUTES のデフォルトは5', () => {
      expect(SCHEDULE_WINDOW_MINUTES).toBe(5);
    });
  });

  describe('logAutoPostExecution', () => {
    test('下書き作成時に error_message が null で記録される', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      getDb.mockReturnValue({
        from: jest.fn().mockReturnValue({ insert: mockInsert })
      });

      await logAutoPostExecution('account-1', 'new', 2, 0, 0, 'success', null);

      expect(mockInsert).toHaveBeenCalledWith({
        account_id: 'account-1',
        post_type: 'new',
        posts_generated: 2,
        posts_scheduled: 0,
        posts_posted: 0,
        status: 'success',
        error_message: null
      });
    });

    test('エラー時は error_message にエラー内容が記録される', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      getDb.mockReturnValue({
        from: jest.fn().mockReturnValue({ insert: mockInsert })
      });

      await logAutoPostExecution('account-1', 'new', 0, 0, 0, 'failed', 'テーマが設定されていません');

      expect(mockInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          error_message: 'テーマが設定されていません'
        })
      );
    });
  });
});
