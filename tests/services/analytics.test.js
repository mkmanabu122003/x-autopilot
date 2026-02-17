// Mock x-api (must be before requiring analytics)
jest.mock('../../server/services/x-api', () => ({
  getMyRepliedTweetIds: jest.fn().mockResolvedValue([])
}));

// Mock database
jest.mock('../../server/db/database', () => {
  return {
    getDb: jest.fn()
  };
});

const { calculateEngagementRate, getReplySuggestions, getQuoteSuggestions } = require('../../server/services/analytics');
const { getDb } = require('../../server/db/database');
const { getMyRepliedTweetIds } = require('../../server/services/x-api');

describe('analytics', () => {
  describe('calculateEngagementRate', () => {
    test('正常なメトリクスでエンゲージメント率を計算', () => {
      const metrics = {
        like_count: 50,
        retweet_count: 10,
        reply_count: 5,
        quote_count: 3,
        impression_count: 10000
      };
      // (50 + 10 + 5 + 3) / 10000 * 100 = 0.68
      expect(calculateEngagementRate(metrics)).toBeCloseTo(0.68, 2);
    });

    test('インプレッション 0 の場合は 0 を返す', () => {
      const metrics = {
        like_count: 10,
        retweet_count: 5,
        reply_count: 2,
        quote_count: 1,
        impression_count: 0
      };
      expect(calculateEngagementRate(metrics)).toBe(0);
    });

    test('インプレッションが null の場合は 0 を返す', () => {
      const metrics = {
        like_count: 10,
        retweet_count: 5,
        reply_count: 2,
        quote_count: 1,
        impression_count: null
      };
      expect(calculateEngagementRate(metrics)).toBe(0);
    });

    test('インプレッションが undefined の場合は 0 を返す', () => {
      const metrics = {
        like_count: 10,
        retweet_count: 5,
        reply_count: 2,
        quote_count: 1,
        impression_count: undefined
      };
      expect(calculateEngagementRate(metrics)).toBe(0);
    });

    test('全メトリクスが 0 の場合は 0 を返す', () => {
      const metrics = {
        like_count: 0,
        retweet_count: 0,
        reply_count: 0,
        quote_count: 0,
        impression_count: 1000
      };
      expect(calculateEngagementRate(metrics)).toBe(0);
    });

    test('高エンゲージメント率を正しく計算', () => {
      const metrics = {
        like_count: 500,
        retweet_count: 200,
        reply_count: 100,
        quote_count: 50,
        impression_count: 1000
      };
      // (500 + 200 + 100 + 50) / 1000 * 100 = 85%
      expect(calculateEngagementRate(metrics)).toBeCloseTo(85, 0);
    });

    test('少数のインプレッションでも正しく計算', () => {
      const metrics = {
        like_count: 1,
        retweet_count: 0,
        reply_count: 0,
        quote_count: 0,
        impression_count: 1
      };
      // (1 + 0 + 0 + 0) / 1 * 100 = 100
      expect(calculateEngagementRate(metrics)).toBe(100);
    });

    test('大きなインプレッション数でも正しく計算', () => {
      const metrics = {
        like_count: 10000,
        retweet_count: 5000,
        reply_count: 2000,
        quote_count: 1000,
        impression_count: 1000000
      };
      // (10000 + 5000 + 2000 + 1000) / 1000000 * 100 = 1.8
      expect(calculateEngagementRate(metrics)).toBeCloseTo(1.8, 1);
    });
  });

  describe('getReplySuggestions', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    function setupDbMock({ engagedRows = [], competitorIds = [], competitorTweets = [] }) {
      const mockFrom = jest.fn((table) => {
        if (table === 'my_posts') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockReturnValue({
                not: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({ data: engagedRows })
                })
              })
            })
          };
        }
        if (table === 'competitors') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: competitorIds.map(id => ({ id })) })
            })
          };
        }
        if (table === 'competitor_tweets') {
          return {
            select: jest.fn().mockReturnValue({
              gte: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  limit: jest.fn().mockReturnValue({
                    in: jest.fn().mockResolvedValue({ data: competitorTweets, error: null })
                  })
                })
              })
            })
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
        };
      });
      getDb.mockReturnValue({ from: mockFrom });
    }

    test('手動でリプライ済みのツイートがフィルタされる', async () => {
      const competitorTweets = [
        { tweet_id: 'tweet-1', text: 'ツイート1', engagement_rate: 5.0, competitors: { handle: 'user1', name: 'User 1' } },
        { tweet_id: 'tweet-2', text: 'ツイート2', engagement_rate: 4.0, competitors: { handle: 'user2', name: 'User 2' } },
        { tweet_id: 'tweet-3', text: 'ツイート3', engagement_rate: 3.0, competitors: { handle: 'user3', name: 'User 3' } },
      ];

      setupDbMock({
        engagedRows: [],
        competitorIds: ['comp-1'],
        competitorTweets
      });

      // tweet-2 was manually replied to on X
      getMyRepliedTweetIds.mockResolvedValue(['tweet-2']);

      const suggestions = await getReplySuggestions('acc-1');
      const ids = suggestions.map(s => s.tweet_id);
      expect(ids).toContain('tweet-1');
      expect(ids).not.toContain('tweet-2');
      expect(ids).toContain('tweet-3');
    });

    test('アプリ内リプライと手動リプライの両方がフィルタされる', async () => {
      const competitorTweets = [
        { tweet_id: 'tweet-1', text: 'ツイート1', engagement_rate: 5.0, competitors: { handle: 'user1', name: 'User 1' } },
        { tweet_id: 'tweet-2', text: 'ツイート2', engagement_rate: 4.0, competitors: { handle: 'user2', name: 'User 2' } },
        { tweet_id: 'tweet-3', text: 'ツイート3', engagement_rate: 3.0, competitors: { handle: 'user3', name: 'User 3' } },
      ];

      setupDbMock({
        engagedRows: [{ target_tweet_id: 'tweet-1' }],  // app reply
        competitorIds: ['comp-1'],
        competitorTweets
      });

      // tweet-2 was manually replied to on X
      getMyRepliedTweetIds.mockResolvedValue(['tweet-2']);

      const suggestions = await getReplySuggestions('acc-1');
      const ids = suggestions.map(s => s.tweet_id);
      expect(ids).not.toContain('tweet-1');  // filtered by app
      expect(ids).not.toContain('tweet-2');  // filtered by manual
      expect(ids).toContain('tweet-3');
    });

    test('手動リプライ取得に失敗してもサジェスションは返る', async () => {
      const competitorTweets = [
        { tweet_id: 'tweet-1', text: 'ツイート1', engagement_rate: 5.0, competitors: { handle: 'user1', name: 'User 1' } },
      ];

      setupDbMock({
        engagedRows: [],
        competitorIds: ['comp-1'],
        competitorTweets
      });

      // Simulate API failure
      getMyRepliedTweetIds.mockRejectedValue(new Error('API error'));

      const suggestions = await getReplySuggestions('acc-1');
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].tweet_id).toBe('tweet-1');
    });

    test('重複するIDが正しくマージされる', async () => {
      const competitorTweets = [
        { tweet_id: 'tweet-1', text: 'ツイート1', engagement_rate: 5.0, competitors: { handle: 'user1', name: 'User 1' } },
        { tweet_id: 'tweet-2', text: 'ツイート2', engagement_rate: 4.0, competitors: { handle: 'user2', name: 'User 2' } },
      ];

      setupDbMock({
        engagedRows: [{ target_tweet_id: 'tweet-1' }],  // app reply to tweet-1
        competitorIds: ['comp-1'],
        competitorTweets
      });

      // tweet-1 also manually replied (duplicate)
      getMyRepliedTweetIds.mockResolvedValue(['tweet-1']);

      const suggestions = await getReplySuggestions('acc-1');
      const ids = suggestions.map(s => s.tweet_id);
      expect(ids).not.toContain('tweet-1');
      expect(ids).toContain('tweet-2');
    });
  });

  describe('getQuoteSuggestions', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    function setupDbMock({ engagedRows = [], competitorIds = [], competitorTweets = [] }) {
      const mockFrom = jest.fn((table) => {
        if (table === 'my_posts') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockReturnValue({
                not: jest.fn().mockReturnValue({
                  eq: jest.fn().mockResolvedValue({ data: engagedRows })
                })
              })
            })
          };
        }
        if (table === 'competitors') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockResolvedValue({ data: competitorIds.map(id => ({ id })) })
            })
          };
        }
        if (table === 'competitor_tweets') {
          return {
            select: jest.fn().mockReturnValue({
              gte: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  limit: jest.fn().mockReturnValue({
                    in: jest.fn().mockResolvedValue({ data: competitorTweets, error: null })
                  })
                })
              })
            })
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
        };
      });
      getDb.mockReturnValue({ from: mockFrom });
    }

    test('手動で引用済みのツイートがフィルタされる', async () => {
      const competitorTweets = [
        { tweet_id: 'tweet-1', text: 'ツイート1', engagement_rate: 5.0, competitors: { handle: 'user1', name: 'User 1' } },
        { tweet_id: 'tweet-2', text: 'ツイート2', engagement_rate: 4.0, competitors: { handle: 'user2', name: 'User 2' } },
      ];

      setupDbMock({
        engagedRows: [],
        competitorIds: ['comp-1'],
        competitorTweets
      });

      // tweet-1 was manually quoted on X
      getMyRepliedTweetIds.mockResolvedValue(['tweet-1']);

      const suggestions = await getQuoteSuggestions('acc-1');
      const ids = suggestions.map(s => s.tweet_id);
      expect(ids).not.toContain('tweet-1');
      expect(ids).toContain('tweet-2');
    });

    test('手動リプライ取得に失敗してもサジェスションは返る', async () => {
      const competitorTweets = [
        { tweet_id: 'tweet-1', text: 'ツイート1', engagement_rate: 5.0, competitors: { handle: 'user1', name: 'User 1' } },
      ];

      setupDbMock({
        engagedRows: [],
        competitorIds: ['comp-1'],
        competitorTweets
      });

      // Simulate API failure
      getMyRepliedTweetIds.mockRejectedValue(new Error('API error'));

      const suggestions = await getQuoteSuggestions('acc-1');
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].tweet_id).toBe('tweet-1');
    });
  });
});
