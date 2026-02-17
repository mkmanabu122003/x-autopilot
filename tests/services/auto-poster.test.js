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

const { logAutoPostExecution } = require('../../server/services/auto-poster');
const { getDb } = require('../../server/db/database');

describe('auto-poster', () => {
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
