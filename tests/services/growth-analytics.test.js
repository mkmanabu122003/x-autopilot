// Mock x-api (must be before requiring the module)
jest.mock('../../server/services/x-api', () => ({
  getTweetMetrics: jest.fn().mockResolvedValue([]),
  getOwnProfile: jest.fn().mockResolvedValue(null),
  checkXApiBudget: jest.fn().mockResolvedValue({ overBudget: false })
}));

// Mock database
jest.mock('../../server/db/database', () => {
  return {
    getDb: jest.fn()
  };
});

// Mock analytics
jest.mock('../../server/services/analytics', () => ({
  calculateEngagementRate: jest.fn().mockReturnValue(0)
}));

const { getOwnPostsPerformance } = require('../../server/services/growth-analytics');
const { getDb } = require('../../server/db/database');

describe('growth-analytics', () => {
  describe('getOwnPostsPerformance', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    function setupDbMock({ posts = [], targetTweets = [] }) {
      const mockFrom = jest.fn((table) => {
        if (table === 'my_posts') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                order: jest.fn().mockReturnValue({
                  limit: jest.fn().mockReturnValue({
                    eq: jest.fn().mockResolvedValue({ data: posts })
                  })
                })
              })
            })
          };
        }
        if (table === 'competitor_tweets') {
          return {
            select: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({ data: targetTweets })
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

    test('新規投稿にはtarget_tweetがnullになる', async () => {
      setupDbMock({
        posts: [
          { id: 1, text: '新規ツイート', post_type: 'new', target_tweet_id: null, status: 'posted' }
        ]
      });

      const result = await getOwnPostsPerformance('acc-1');
      expect(result).toHaveLength(1);
      expect(result[0].target_tweet).toBeNull();
    });

    test('リプライ投稿に元ツイート情報が付与される', async () => {
      setupDbMock({
        posts: [
          { id: 1, text: 'リプライ内容', post_type: 'reply', target_tweet_id: 'tweet-100', status: 'posted' }
        ],
        targetTweets: [
          { tweet_id: 'tweet-100', text: '元ツイートの内容', competitor_id: 1, competitors: { handle: 'competitor1', name: 'Competitor 1' } }
        ]
      });

      const result = await getOwnPostsPerformance('acc-1');
      expect(result).toHaveLength(1);
      expect(result[0].target_tweet).toEqual({
        text: '元ツイートの内容',
        handle: 'competitor1',
        name: 'Competitor 1'
      });
    });

    test('引用RT投稿に元ツイート情報が付与される', async () => {
      setupDbMock({
        posts: [
          { id: 2, text: '引用コメント', post_type: 'quote', target_tweet_id: 'tweet-200', status: 'posted' }
        ],
        targetTweets: [
          { tweet_id: 'tweet-200', text: '引用元ツイート', competitor_id: 2, competitors: { handle: 'user2', name: 'User 2' } }
        ]
      });

      const result = await getOwnPostsPerformance('acc-1');
      expect(result).toHaveLength(1);
      expect(result[0].target_tweet).toEqual({
        text: '引用元ツイート',
        handle: 'user2',
        name: 'User 2'
      });
    });

    test('対象ツイートがDBに存在しない場合はtarget_tweetがnullになる', async () => {
      setupDbMock({
        posts: [
          { id: 3, text: 'リプライ内容', post_type: 'reply', target_tweet_id: 'unknown-tweet', status: 'posted' }
        ],
        targetTweets: []
      });

      const result = await getOwnPostsPerformance('acc-1');
      expect(result).toHaveLength(1);
      expect(result[0].target_tweet).toBeNull();
    });

    test('複数の投稿タイプが混在する場合に正しくマッピングされる', async () => {
      setupDbMock({
        posts: [
          { id: 1, text: '新規', post_type: 'new', target_tweet_id: null, status: 'posted' },
          { id: 2, text: 'リプライ', post_type: 'reply', target_tweet_id: 'tweet-100', status: 'posted' },
          { id: 3, text: '引用', post_type: 'quote', target_tweet_id: 'tweet-200', status: 'posted' },
        ],
        targetTweets: [
          { tweet_id: 'tweet-100', text: '返信先の内容', competitor_id: 1, competitors: { handle: 'user1', name: 'User 1' } },
          { tweet_id: 'tweet-200', text: '引用元の内容', competitor_id: 2, competitors: { handle: 'user2', name: 'User 2' } },
        ]
      });

      const result = await getOwnPostsPerformance('acc-1');
      expect(result).toHaveLength(3);
      expect(result[0].target_tweet).toBeNull();
      expect(result[1].target_tweet).toEqual({
        text: '返信先の内容',
        handle: 'user1',
        name: 'User 1'
      });
      expect(result[2].target_tweet).toEqual({
        text: '引用元の内容',
        handle: 'user2',
        name: 'User 2'
      });
    });

    test('投稿がない場合は空配列を返す', async () => {
      setupDbMock({ posts: [] });

      const result = await getOwnPostsPerformance('acc-1');
      expect(result).toEqual([]);
    });
  });
});
