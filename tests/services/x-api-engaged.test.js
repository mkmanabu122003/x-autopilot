// Mock database
jest.mock('../../server/db/database', () => {
  const mockChain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
  return {
    getDb: jest.fn(() => ({
      from: jest.fn(() => mockChain)
    }))
  };
});

// Mock crypto
jest.mock('../../server/utils/crypto', () => ({
  decrypt: jest.fn(val => val)
}));

// We need to mock fetch globally
const originalFetch = global.fetch;

const { getDb } = require('../../server/db/database');

describe('getManuallyEngagedTweetIds', () => {
  let getManuallyEngagedTweetIds;

  beforeAll(() => {
    // Mock fetch before importing the module
    global.fetch = jest.fn();
    // Clear module cache so x-api gets the mocked fetch
    jest.resetModules();
    // Re-mock after reset
    jest.mock('../../server/db/database', () => {
      const mockChain = {
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: null, error: null }),
      };
      return {
        getDb: jest.fn(() => ({
          from: jest.fn(() => mockChain)
        }))
      };
    });
    jest.mock('../../server/utils/crypto', () => ({
      decrypt: jest.fn(val => val)
    }));
    const xApi = require('../../server/services/x-api');
    getManuallyEngagedTweetIds = xApi.getManuallyEngagedTweetIds;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('X APIの応答からリプライ先と引用元のtweet_idを抽出する', async () => {
    const { getDb: getDbMock } = require('../../server/db/database');
    const mockFrom = jest.fn();

    // Mock account lookup
    const accountChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { handle: 'testuser' }, error: null })
    };

    mockFrom
      .mockReturnValueOnce(accountChain)   // x_accounts query
      .mockReturnValueOnce({               // api_usage_log for budget check
        select: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        like: jest.fn().mockResolvedValue({ data: [] })
      })
      .mockReturnValueOnce({               // settings for budget
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        single: jest.fn().mockResolvedValue({ data: { value: '100' } })
      })
      .mockReturnValue({                   // subsequent queries (api_usage_log inserts, etc.)
        insert: jest.fn().mockResolvedValue({ error: null }),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        gte: jest.fn().mockReturnThis(),
        like: jest.fn().mockResolvedValue({ data: [] }),
        single: jest.fn().mockResolvedValue({ data: { handle: 'testuser', api_key: 'k', api_secret: 's', access_token: 't', access_token_secret: 'ts', bearer_token: 'bt' } })
      });

    getDbMock.mockReturnValue({ from: mockFrom });

    // Mock fetch responses
    global.fetch
      // getUserByHandle response
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: { id: '12345', username: 'testuser' } })
      })
      // getUserByHandle api_usage_log insert (ignored)
      // getUserTweets response
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [
            {
              id: 'tweet-a',
              text: 'My reply',
              referenced_tweets: [{ type: 'replied_to', id: 'target-111' }]
            },
            {
              id: 'tweet-b',
              text: 'My quote',
              referenced_tweets: [{ type: 'quoted', id: 'target-222' }]
            },
            {
              id: 'tweet-c',
              text: 'My original tweet'
              // no referenced_tweets
            }
          ]
        })
      });

    const result = await getManuallyEngagedTweetIds(1);
    expect(result).toContain('target-111');
    expect(result).toContain('target-222');
    expect(result).not.toContain('tweet-c');
    expect(result).toHaveLength(2);
  });

  test('X API呼び出しが失敗した場合は空配列を返す', async () => {
    const { getDb: getDbMock } = require('../../server/db/database');

    // Mock account lookup failure
    const mockFrom = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } })
    });
    getDbMock.mockReturnValue({ from: mockFrom });

    const result = await getManuallyEngagedTweetIds(999);
    expect(result).toEqual([]);
  });

  test('ハンドルがない場合は空配列を返す', async () => {
    const { getDb: getDbMock } = require('../../server/db/database');

    const mockFrom = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: { handle: null }, error: null })
    });
    getDbMock.mockReturnValue({ from: mockFrom });

    const result = await getManuallyEngagedTweetIds(1);
    expect(result).toEqual([]);
  });
});
