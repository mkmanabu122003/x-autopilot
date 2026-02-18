// Mock database
jest.mock('../../server/db/database', () => {
  const mockChain = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockResolvedValue({ error: null }),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
    gte: jest.fn().mockReturnThis(),
    like: jest.fn().mockReturnThis(),
  };
  return {
    getDb: jest.fn(() => ({
      from: jest.fn(() => mockChain)
    }))
  };
});

// Mock crypto util
jest.mock('../../server/utils/crypto', () => ({
  decrypt: jest.fn(val => val)
}));

// Save original fetch
const originalFetch = global.fetch;

const { getMyRepliedTweetIds, apiCache } = require('../../server/services/x-api');
const { getDb } = require('../../server/db/database');

describe('x-api', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    apiCache.clear();
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('getMyRepliedTweetIds', () => {
    function setupMocks({ profileData, tweetsData, credentials, budgetOverBudget = false }) {
      // Mock getDb for budget check and account credentials
      const mockFrom = jest.fn((table) => {
        if (table === 'api_usage_log') {
          return {
            select: jest.fn().mockReturnValue({
              gte: jest.fn().mockReturnValue({
                like: jest.fn().mockResolvedValue({ data: [] })
              })
            }),
            insert: jest.fn().mockResolvedValue({ error: null })
          };
        }
        if (table === 'settings') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: budgetOverBudget ? { value: '0' } : { value: '100' },
                  error: null
                })
              })
            })
          };
        }
        if (table === 'x_accounts') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: credentials || {
                    id: 'acc-1',
                    api_key: 'key',
                    api_secret: 'secret',
                    access_token: 'token',
                    access_token_secret: 'token_secret',
                    bearer_token: 'bearer_token',
                    handle: 'testuser'
                  },
                  error: null
                })
              })
            })
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          insert: jest.fn().mockResolvedValue({ error: null }),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
        };
      });

      getDb.mockReturnValue({ from: mockFrom });

      // Mock fetch for getOwnProfile and getUserTweets
      let fetchCallCount = 0;
      global.fetch = jest.fn(() => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          // getOwnProfile call
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: profileData || { id: 'user-123', username: 'testuser' } })
          });
        }
        // getUserTweets call
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(tweetsData || { data: [] })
        });
      });
    }

    test('リプライ済み・引用済みのツイートIDを返す', async () => {
      setupMocks({
        tweetsData: {
          data: [
            {
              id: 'my-tweet-1',
              text: 'リプライ内容',
              referenced_tweets: [{ type: 'replied_to', id: 'target-tweet-100' }]
            },
            {
              id: 'my-tweet-2',
              text: '引用内容',
              referenced_tweets: [{ type: 'quoted', id: 'target-tweet-200' }]
            },
            {
              id: 'my-tweet-3',
              text: '通常のツイート'
              // no referenced_tweets
            }
          ]
        }
      });

      const result = await getMyRepliedTweetIds('acc-1');
      expect(result).toEqual(['target-tweet-100', 'target-tweet-200']);
    });

    test('referenced_tweetsがないツイートのみの場合は空配列を返す', async () => {
      setupMocks({
        tweetsData: {
          data: [
            { id: 'my-tweet-1', text: '通常のツイート' },
            { id: 'my-tweet-2', text: '別のツイート' }
          ]
        }
      });

      const result = await getMyRepliedTweetIds('acc-1');
      expect(result).toEqual([]);
    });

    test('API応答にデータがない場合は空配列を返す', async () => {
      setupMocks({
        tweetsData: { data: null }
      });

      const result = await getMyRepliedTweetIds('acc-1');
      expect(result).toEqual([]);
    });

    test('accountIdがnullの場合は空配列を返す', async () => {
      const result = await getMyRepliedTweetIds(null);
      expect(result).toEqual([]);
    });

    test('APIエラー時はグレースフルに空配列を返す', async () => {
      setupMocks({});
      // Override fetch to return error for the tweets call
      let fetchCallCount = 0;
      global.fetch = jest.fn(() => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          // getOwnProfile call - success
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ data: { id: 'user-123', username: 'testuser' } })
          });
        }
        // getUserTweets call - failure
        return Promise.resolve({
          ok: false,
          status: 429,
          json: () => Promise.resolve({ error: 'rate limit' })
        });
      });

      const result = await getMyRepliedTweetIds('acc-1');
      expect(result).toEqual([]);
    });

    test('キャッシュが効いている場合はAPIを呼ばない', async () => {
      setupMocks({
        tweetsData: {
          data: [
            {
              id: 'my-tweet-1',
              referenced_tweets: [{ type: 'replied_to', id: 'cached-tweet-1' }]
            }
          ]
        }
      });

      // First call - should call API
      const result1 = await getMyRepliedTweetIds('acc-1');
      expect(result1).toEqual(['cached-tweet-1']);
      const firstFetchCount = global.fetch.mock.calls.length;

      // Second call - should use cache
      const result2 = await getMyRepliedTweetIds('acc-1');
      expect(result2).toEqual(['cached-tweet-1']);
      // fetch should not have been called again
      expect(global.fetch.mock.calls.length).toBe(firstFetchCount);
    });

    test('retweetタイプはフィルタ対象外', async () => {
      setupMocks({
        tweetsData: {
          data: [
            {
              id: 'my-tweet-1',
              referenced_tweets: [{ type: 'retweeted', id: 'rt-tweet-1' }]
            },
            {
              id: 'my-tweet-2',
              referenced_tweets: [{ type: 'replied_to', id: 'reply-tweet-1' }]
            }
          ]
        }
      });

      const result = await getMyRepliedTweetIds('acc-1');
      // Only replied_to should be included, not retweeted
      expect(result).toEqual(['reply-tweet-1']);
    });

    test('予算超過時は空配列を返す', async () => {
      // Set up mocks with budget exceeded
      const mockFrom = jest.fn((table) => {
        if (table === 'api_usage_log') {
          return {
            select: jest.fn().mockReturnValue({
              gte: jest.fn().mockReturnValue({
                like: jest.fn().mockResolvedValue({
                  data: [{ cost_usd: 100 }]
                })
              })
            }),
            insert: jest.fn().mockResolvedValue({ error: null })
          };
        }
        if (table === 'settings') {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: { value: '10' },
                  error: null
                })
              })
            })
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null }),
        };
      });

      getDb.mockReturnValue({ from: mockFrom });
      global.fetch = jest.fn();

      const result = await getMyRepliedTweetIds('acc-1');
      expect(result).toEqual([]);
      // fetch should not be called since budget is exceeded
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });
});
