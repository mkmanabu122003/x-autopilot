// Mock database
jest.mock('../../server/db/database', () => {
  const mockChain = {
    select: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    lte: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    single: jest.fn().mockResolvedValue({ data: null, error: null }),
  };
  return {
    getDb: jest.fn(() => ({
      from: jest.fn(() => mockChain)
    }))
  };
});

// Mock x-api
const mockPostTweet = jest.fn().mockResolvedValue({ data: { id: 'tweet-123' } });
jest.mock('../../server/services/x-api', () => ({
  postTweet: mockPostTweet,
  getUserTweets: jest.fn().mockResolvedValue({ data: [] })
}));

// Mock other scheduler dependencies
jest.mock('../../server/services/analytics', () => ({
  calculateEngagementRate: jest.fn().mockReturnValue(0)
}));

jest.mock('../../server/services/batch-manager', () => ({
  BatchManager: jest.fn().mockImplementation(() => ({
    pollBatchResults: jest.fn()
  }))
}));

jest.mock('../../server/services/auto-poster', () => ({
  checkAndRunAutoPosts: jest.fn(),
  isDeletedTweetError: (msg) => {
    if (!msg) return false;
    return msg.includes('deleted or not visible') ||
      (msg.includes('X API error 403') && msg.includes('Forbidden'));
  }
}));

jest.mock('../../server/services/growth-analytics', () => ({
  refreshOwnPostMetrics: jest.fn(),
  recordFollowerSnapshot: jest.fn()
}));

jest.mock('../../server/services/tweet-improver', () => ({
  generateImprovementInsights: jest.fn().mockResolvedValue({ status: 'ok' }),
  autoAdjustSettings: jest.fn().mockResolvedValue({ adjusted: false })
}));

jest.mock('node-cron', () => ({
  schedule: jest.fn()
}), { virtual: true });

const { processScheduledPosts } = require('../../server/services/scheduler');
const { getDb } = require('../../server/db/database');

// Helper to create a mock DB with proper chaining
function createMockDb(queryResult, updateResult) {
  const updateChain = {
    eq: jest.fn().mockResolvedValue(updateResult || { error: null })
  };
  const queryChain = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    lte: jest.fn().mockResolvedValue(queryResult),
    update: jest.fn().mockReturnValue(updateChain),
  };
  return {
    from: jest.fn().mockReturnValue(queryChain),
    _queryChain: queryChain,
    _updateChain: updateChain,
  };
}

describe('processScheduledPosts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('予約時刻を過ぎた投稿が正しく処理される', async () => {
    const scheduledPost = {
      id: 1, account_id: 10, text: 'テスト投稿',
      post_type: 'new', target_tweet_id: null,
      status: 'scheduled', scheduled_at: '2026-02-17T00:00:00.000Z'
    };

    const mockDb = createMockDb({ data: [scheduledPost], error: null });
    getDb.mockReturnValue(mockDb);

    await processScheduledPosts();

    expect(mockPostTweet).toHaveBeenCalledWith('テスト投稿', { accountId: 10 });
  });

  test('リプライの予約投稿が正しいオプションで投稿される', async () => {
    const scheduledReply = {
      id: 2, account_id: 10, text: 'リプライテスト',
      post_type: 'reply', target_tweet_id: 'target-tweet-1',
      status: 'scheduled', scheduled_at: '2026-02-17T00:00:00.000Z'
    };

    const mockDb = createMockDb({ data: [scheduledReply], error: null });
    getDb.mockReturnValue(mockDb);

    await processScheduledPosts();

    expect(mockPostTweet).toHaveBeenCalledWith('リプライテスト', {
      accountId: 10,
      replyToId: 'target-tweet-1'
    });
  });

  test('引用RTの予約投稿が正しいオプションで投稿される', async () => {
    const scheduledQuote = {
      id: 3, account_id: 10, text: '引用テスト',
      post_type: 'quote', target_tweet_id: 'target-tweet-2',
      status: 'scheduled', scheduled_at: '2026-02-17T00:00:00.000Z'
    };

    const mockDb = createMockDb({ data: [scheduledQuote], error: null });
    getDb.mockReturnValue(mockDb);

    await processScheduledPosts();

    expect(mockPostTweet).toHaveBeenCalledWith('引用テスト', {
      accountId: 10,
      quoteTweetId: 'target-tweet-2'
    });
  });

  test('投稿が0件の場合は何も処理しない', async () => {
    const mockDb = createMockDb({ data: [], error: null });
    getDb.mockReturnValue(mockDb);

    await processScheduledPosts();

    expect(mockPostTweet).not.toHaveBeenCalled();
  });

  test('DBクエリがエラーを返した場合は何も処理しない', async () => {
    const mockDb = createMockDb({ data: null, error: { message: 'DB error' } });
    getDb.mockReturnValue(mockDb);

    await processScheduledPosts();

    expect(mockPostTweet).not.toHaveBeenCalled();
  });

  test('postTweet が失敗した場合はステータスが failed に更新される', async () => {
    const scheduledPost = {
      id: 4, account_id: 10, text: '失敗テスト',
      post_type: 'new', target_tweet_id: null,
      status: 'scheduled', scheduled_at: '2026-02-17T00:00:00.000Z'
    };

    const mockDb = createMockDb({ data: [scheduledPost], error: null });
    getDb.mockReturnValue(mockDb);
    mockPostTweet.mockRejectedValueOnce(new Error('X API error 401'));

    await processScheduledPosts();

    // Verify update was called with 'failed' status and error_message
    expect(mockDb._queryChain.update).toHaveBeenCalledWith({ status: 'failed', error_message: 'X API error 401' });
  });

  test('複数の予約投稿が順番に処理される', async () => {
    const posts = [
      { id: 5, account_id: 10, text: '投稿1', post_type: 'new', target_tweet_id: null, status: 'scheduled', scheduled_at: '2026-02-17T00:00:00.000Z' },
      { id: 6, account_id: 11, text: '投稿2', post_type: 'new', target_tweet_id: null, status: 'scheduled', scheduled_at: '2026-02-17T00:01:00.000Z' },
    ];

    const mockDb = createMockDb({ data: posts, error: null });
    getDb.mockReturnValue(mockDb);

    await processScheduledPosts();

    expect(mockPostTweet).toHaveBeenCalledTimes(2);
    expect(mockPostTweet).toHaveBeenCalledWith('投稿1', { accountId: 10 });
    expect(mockPostTweet).toHaveBeenCalledWith('投稿2', { accountId: 11 });
  });

  test('元ツイートが削除された場合はユーザーフレンドリーなエラーメッセージで失敗にする', async () => {
    const scheduledReply = {
      id: 7, account_id: 10, text: 'リプライ',
      post_type: 'reply', target_tweet_id: 'deleted-tweet',
      status: 'scheduled', scheduled_at: '2026-02-17T00:00:00.000Z'
    };

    const mockDb = createMockDb({ data: [scheduledReply], error: null });
    getDb.mockReturnValue(mockDb);
    mockPostTweet.mockRejectedValueOnce(
      new Error('X API error 403: {"detail":"You attempted to reply to a Tweet that is deleted or not visible to you.","title":"Forbidden","status":403}')
    );

    await processScheduledPosts();

    // Verify update was called with user-friendly error message (not raw API error)
    expect(mockDb._queryChain.update).toHaveBeenCalledWith({
      status: 'failed',
      error_message: '元ツイートが削除されたため投稿できませんでした'
    });
  });
});
