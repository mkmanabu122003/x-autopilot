// Mock database
const mockFrom = jest.fn();
const mockChain = {
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: null, error: null }),
  order: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
};

jest.mock('../../server/db/database', () => ({
  getDb: jest.fn(() => ({ from: mockFrom }))
}));

// Mock telegram-bot
const mockSendTweetProposal = jest.fn();
const mockSendNotification = jest.fn();
const mockUpdateMessage = jest.fn();
const mockInitTelegramBot = jest.fn();
const mockGetTelegramChatId = jest.fn();
const mockGetBot = jest.fn();

jest.mock('../../server/services/telegram-bot', () => ({
  sendTweetProposal: mockSendTweetProposal,
  sendNotification: mockSendNotification,
  updateMessage: mockUpdateMessage,
  initTelegramBot: mockInitTelegramBot,
  getTelegramChatId: mockGetTelegramChatId,
  getBot: mockGetBot
}));

// Mock AI provider
const mockGenerateTweets = jest.fn();
jest.mock('../../server/services/ai-provider', () => ({
  getAIProvider: jest.fn(() => ({
    generateTweets: mockGenerateTweets
  }))
}));

// Mock X API
const mockPostTweet = jest.fn();
jest.mock('../../server/services/x-api', () => ({
  postTweet: mockPostTweet
}));

// Mock app-logger
jest.mock('../../server/services/app-logger', () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn()
}));

const {
  triggerTweetProposal,
  approveTweet,
  confirmApprove,
  rejectTweet,
  regenerateTweet,
  startEditSession,
  processEditFeedback,
  handleCallback,
  handleMessage
} = require('../../server/services/telegram-workflow');

describe('telegram-workflow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetTelegramChatId.mockReturnValue('12345');

    // Reset mockChain methods
    Object.values(mockChain).forEach(fn => fn.mockReturnThis());
    mockChain.single.mockResolvedValue({ data: null, error: null });
  });

  function setupFromMock(handlers) {
    mockFrom.mockImplementation((table) => {
      const handler = handlers[table];
      if (handler) return handler();
      return mockChain;
    });
  }

  describe('triggerTweetProposal', () => {
    test('should generate tweets, save as drafts, and send to Telegram', async () => {
      mockGenerateTweets.mockResolvedValue({
        provider: 'claude',
        model: 'claude-sonnet-4-20250514',
        candidates: [
          { text: 'ツイート案1' },
          { text: 'ツイート案2' },
          { text: 'ツイート案3' }
        ]
      });

      // Batch insert returns array of posts
      const insertChain = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue({
          data: [
            { id: 'post-1', text: 'ツイート案1' },
            { id: 'post-2', text: 'ツイート案2' },
            { id: 'post-3', text: 'ツイート案3' }
          ],
          error: null
        })
      };

      const updateChain = {
        update: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
      };

      setupFromMock({
        my_posts: () => ({
          ...insertChain,
          update: updateChain.update,
          eq: updateChain.eq
        })
      });

      mockSendTweetProposal.mockResolvedValue({ message_id: 100 });

      const result = await triggerTweetProposal('account-1', {
        theme: 'AI技術',
        postType: 'new'
      });

      expect(result.generated).toBe(3);
      expect(result.postIds).toHaveLength(3);
      expect(mockGenerateTweets).toHaveBeenCalledTimes(1);
      expect(mockSendTweetProposal).toHaveBeenCalledTimes(3);
      expect(mockSendTweetProposal).toHaveBeenCalledWith('12345', expect.objectContaining({
        postId: 'post-1',
        text: 'ツイート案1',
        index: 1,
        total: 3,
        postType: 'new'
      }));

      // Verify generation_theme and generation_batch_id are included in insert rows
      const insertCall = insertChain.insert.mock.calls[0][0];
      expect(insertCall[0]).toHaveProperty('generation_theme', 'AI技術');
      expect(insertCall[0]).toHaveProperty('generation_batch_id');
      expect(insertCall[0].generation_batch_id).toBeTruthy();
      // All rows in same batch should share the same batch_id
      expect(insertCall[1].generation_batch_id).toBe(insertCall[0].generation_batch_id);
    });

    test('should throw when chat ID is not configured', async () => {
      mockGetTelegramChatId.mockReturnValue(null);
      await expect(triggerTweetProposal('account-1')).rejects.toThrow('Telegram Chat ID が設定されていません');
    });

    test('should throw when DB insert fails', async () => {
      mockGenerateTweets.mockResolvedValue({
        provider: 'claude',
        model: 'test',
        candidates: [{ text: 'ツイート案' }]
      });

      const insertChain = {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockResolvedValue({
          data: null,
          error: { message: 'column "telegram_chat_id" does not exist' }
        })
      };

      setupFromMock({
        my_posts: () => insertChain
      });

      await expect(triggerTweetProposal('account-1', { theme: 'テスト' }))
        .rejects.toThrow('下書き保存エラー');
    });

    test('should throw when no candidates are generated', async () => {
      mockGenerateTweets.mockResolvedValue({
        provider: 'claude',
        model: 'test',
        candidates: []
      });

      await expect(triggerTweetProposal('account-1')).rejects.toThrow('ツイート案の生成に失敗しました');
    });
  });

  describe('approveTweet', () => {
    function buildMyPostsChain(mockPost) {
      // Build a chain object where every method returns itself, supporting arbitrary chaining
      const chain = {};
      chain.select = jest.fn().mockReturnValue(chain);
      chain.update = jest.fn().mockReturnValue(chain);
      chain.eq = jest.fn().mockReturnValue(chain);
      chain.single = jest.fn().mockResolvedValue({ data: mockPost, error: null });
      return chain;
    }

    test('should post tweet and update status', async () => {
      const mockPost = {
        id: 'post-1',
        text: 'テストツイート',
        account_id: 'account-1',
        post_type: 'new',
        status: 'draft',
        telegram_chat_id: '12345',
        telegram_message_id: '100'
      };

      setupFromMock({
        my_posts: () => buildMyPostsChain(mockPost)
      });

      mockPostTweet.mockResolvedValue({ data: { id: 'tweet-123' } });
      mockUpdateMessage.mockResolvedValue({});

      const result = await approveTweet('post-1');

      expect(result.tweetId).toBe('tweet-123');
      expect(mockPostTweet).toHaveBeenCalledWith('テストツイート', { accountId: 'account-1' });
      expect(mockUpdateMessage).toHaveBeenCalledWith('12345', 100,
        expect.stringContaining('投稿完了'));
    });

    test('should handle reply post type', async () => {
      const mockPost = {
        id: 'post-2',
        text: 'リプライ',
        account_id: 'account-1',
        post_type: 'reply',
        target_tweet_id: 'target-1',
        status: 'draft',
        telegram_chat_id: '12345'
      };

      setupFromMock({
        my_posts: () => buildMyPostsChain(mockPost)
      });

      mockPostTweet.mockResolvedValue({ data: { id: 'tweet-456' } });

      await approveTweet('post-2');

      expect(mockPostTweet).toHaveBeenCalledWith('リプライ', {
        accountId: 'account-1',
        replyToId: 'target-1'
      });
    });

    test('should auto-reject sibling drafts in the same batch when approved', async () => {
      const mockPost = {
        id: 'post-1',
        text: '承認されたツイート',
        account_id: 'account-1',
        post_type: 'new',
        status: 'draft',
        telegram_chat_id: '12345',
        telegram_message_id: '100',
        generation_batch_id: 'batch-123'
      };

      const siblings = [
        { id: 'post-2', telegram_chat_id: '12345', telegram_message_id: '101', text: '却下される案2' },
        { id: 'post-3', telegram_chat_id: '12345', telegram_message_id: '102', text: '却下される案3' }
      ];

      let callCount = 0;
      setupFromMock({
        my_posts: () => {
          callCount++;
          const chain = {};
          chain.select = jest.fn().mockReturnValue(chain);
          chain.update = jest.fn().mockReturnValue(chain);
          chain.eq = jest.fn().mockReturnValue(chain);
          chain.neq = jest.fn().mockReturnValue(chain);
          // First call: get the post (single), second: sibling select
          chain.single = jest.fn().mockResolvedValue({ data: mockPost, error: null });
          // For sibling query (select without single), resolve with siblings data
          chain.then = undefined;
          // Override to return siblings when querying by batch
          const originalEq = chain.eq;
          chain.eq = jest.fn((...args) => {
            // Return siblings for batch query
            if (args[0] === 'generation_batch_id') {
              return {
                eq: jest.fn().mockReturnValue({
                  neq: jest.fn().mockResolvedValue({ data: siblings })
                })
              };
            }
            return chain;
          });
          return chain;
        }
      });

      mockPostTweet.mockResolvedValue({ data: { id: 'tweet-100' } });
      mockUpdateMessage.mockResolvedValue({});

      const result = await approveTweet('post-1');

      expect(result.tweetId).toBe('tweet-100');
      // Verify updateMessage was called for siblings (auto-reject messages)
      expect(mockUpdateMessage).toHaveBeenCalledWith('12345', 101,
        expect.stringContaining('自動却下'));
      expect(mockUpdateMessage).toHaveBeenCalledWith('12345', 102,
        expect.stringContaining('自動却下'));
    });

    test('should notify on post failure and mark as failed', async () => {
      const mockPost = {
        id: 'post-3',
        text: 'エラーツイート',
        account_id: 'account-1',
        post_type: 'new',
        status: 'draft',
        telegram_chat_id: '12345'
      };

      setupFromMock({
        my_posts: () => buildMyPostsChain(mockPost)
      });

      mockPostTweet.mockRejectedValue(new Error('API error'));

      await expect(approveTweet('post-3')).rejects.toThrow('API error');
      expect(mockSendNotification).toHaveBeenCalledWith('12345',
        expect.stringContaining('投稿に失敗しました'));
    });
  });

  describe('rejectTweet', () => {
    test('should mark post as rejected and update Telegram message', async () => {
      const mockPost = {
        id: 'post-1',
        text: '却下ツイート',
        status: 'draft',
        telegram_chat_id: '12345',
        telegram_message_id: '100'
      };

      const chain = {};
      chain.select = jest.fn().mockReturnValue(chain);
      chain.update = jest.fn().mockReturnValue(chain);
      chain.eq = jest.fn().mockReturnValue(chain);
      chain.single = jest.fn().mockResolvedValue({ data: mockPost, error: null });

      setupFromMock({
        my_posts: () => chain
      });

      mockUpdateMessage.mockResolvedValue({});

      await rejectTweet('post-1');

      expect(mockUpdateMessage).toHaveBeenCalledWith('12345', 100,
        expect.stringContaining('却下済み'));
    });
  });

  describe('startEditSession', () => {
    test('should create session and send notification', async () => {
      const deleteChain = {
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: null })
      };

      const insertChain = {
        insert: jest.fn().mockResolvedValue({ error: null })
      };

      setupFromMock({
        my_posts: () => ({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: { id: 'post-1' }, error: null })
        }),
        telegram_sessions: () => ({
          ...deleteChain,
          insert: insertChain.insert
        })
      });

      mockSendNotification.mockResolvedValue({});

      await startEditSession('post-1', '12345');

      expect(mockSendNotification).toHaveBeenCalledWith('12345',
        expect.stringContaining('編集依頼モード'));
    });
  });

  describe('processEditFeedback', () => {
    test('should regenerate tweet with feedback and send new proposals', async () => {
      const mockSession = {
        id: 'session-1',
        chat_id: '12345',
        post_id: 'post-1',
        state: 'awaiting_feedback',
        expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
      };

      const mockPost = {
        id: 'post-1',
        text: '元のツイート',
        account_id: 'account-1',
        post_type: 'new',
        ai_provider: 'claude',
        ai_model: 'claude-sonnet-4-20250514'
      };

      setupFromMock({
        telegram_sessions: () => ({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: mockSession, error: null }),
          delete: jest.fn().mockReturnThis(),
        }),
        my_posts: () => ({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: mockPost, error: null }),
          update: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnValue({
            select: jest.fn().mockResolvedValue({
              data: [
                { id: 'new-post-1', text: '修正案1' },
                { id: 'new-post-2', text: '修正案2' }
              ],
              error: null
            })
          })
        })
      });

      mockGenerateTweets.mockResolvedValue({
        provider: 'claude',
        model: 'claude-sonnet-4-20250514',
        candidates: [
          { text: '修正案1' },
          { text: '修正案2' }
        ]
      });

      mockSendTweetProposal.mockResolvedValue({ message_id: 200 });
      mockSendNotification.mockResolvedValue({});

      const result = await processEditFeedback('12345', 'もっとカジュアルに');

      expect(result).toBe(true);
      expect(mockGenerateTweets).toHaveBeenCalledWith('修正', expect.objectContaining({
        customPrompt: expect.stringContaining('もっとカジュアルに')
      }));
      expect(mockSendNotification).toHaveBeenCalledWith('12345',
        expect.stringContaining('フィードバックを反映して再生成中'));
      expect(mockSendTweetProposal).toHaveBeenCalledTimes(2);
    });

    test('should return false when no active session', async () => {
      setupFromMock({
        telegram_sessions: () => ({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } })
        })
      });

      const result = await processEditFeedback('12345', 'feedback');
      expect(result).toBe(false);
    });

    test('should handle expired session', async () => {
      const expiredSession = {
        id: 'session-1',
        chat_id: '12345',
        post_id: 'post-1',
        state: 'awaiting_feedback',
        expires_at: new Date(Date.now() - 1000).toISOString() // expired
      };

      setupFromMock({
        telegram_sessions: () => ({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: expiredSession, error: null }),
          delete: jest.fn().mockReturnThis(),
        })
      });

      mockSendNotification.mockResolvedValue({});

      const result = await processEditFeedback('12345', 'feedback');
      expect(result).toBe(true);
      expect(mockSendNotification).toHaveBeenCalledWith('12345',
        expect.stringContaining('有効期限が切れました'));
    });
  });

  describe('handleCallback', () => {
    function buildChain(mockPost) {
      const chain = {};
      chain.select = jest.fn().mockReturnValue(chain);
      chain.update = jest.fn().mockReturnValue(chain);
      chain.eq = jest.fn().mockReturnValue(chain);
      chain.single = jest.fn().mockResolvedValue({ data: mockPost, error: null });
      return chain;
    }

    test('should route approve callback correctly', async () => {
      const mockPost = {
        id: 'post-1',
        text: 'テスト',
        account_id: 'account-1',
        post_type: 'new',
        status: 'draft',
        telegram_chat_id: '12345',
        telegram_message_id: '100'
      };

      setupFromMock({ my_posts: () => buildChain(mockPost) });

      mockPostTweet.mockResolvedValue({ data: { id: 'tweet-1' } });
      mockUpdateMessage.mockResolvedValue({});

      await handleCallback({
        data: 'approve:post-1',
        message: { chat: { id: 12345 } }
      });

      expect(mockPostTweet).toHaveBeenCalled();
    });

    test('should route reject callback correctly', async () => {
      const mockPost = {
        id: 'post-1',
        text: 'テスト',
        status: 'draft',
        telegram_chat_id: '12345',
        telegram_message_id: '100'
      };

      setupFromMock({ my_posts: () => buildChain(mockPost) });

      mockUpdateMessage.mockResolvedValue({});

      await handleCallback({
        data: 'reject:post-1',
        message: { chat: { id: 12345 } }
      });

      expect(mockUpdateMessage).toHaveBeenCalledWith('12345', 100,
        expect.stringContaining('却下済み'));
    });

    test('should route confirm_approve callback correctly', async () => {
      const mockPost = {
        id: 'post-1',
        text: 'ファクトチェック警告付き',
        account_id: 'account-1',
        post_type: 'new',
        status: 'draft',
        telegram_chat_id: '12345',
        telegram_message_id: '100'
      };

      setupFromMock({ my_posts: () => buildChain(mockPost) });

      mockGetBot.mockReturnValue({
        editMessageText: jest.fn().mockResolvedValue({})
      });

      // confirm_approve should NOT call postTweet (it shows confirmation instead)
      await handleCallback({
        data: 'confirm_approve:post-1',
        message: { chat: { id: 12345 } }
      });

      expect(mockPostTweet).not.toHaveBeenCalled();
    });

    test('should route force_approve callback to approveTweet', async () => {
      const mockPost = {
        id: 'post-1',
        text: 'テスト',
        account_id: 'account-1',
        post_type: 'new',
        status: 'draft',
        telegram_chat_id: '12345',
        telegram_message_id: '100'
      };

      setupFromMock({ my_posts: () => buildChain(mockPost) });

      mockPostTweet.mockResolvedValue({ data: { id: 'tweet-1' } });
      mockUpdateMessage.mockResolvedValue({});

      await handleCallback({
        data: 'force_approve:post-1',
        message: { chat: { id: 12345 } }
      });

      expect(mockPostTweet).toHaveBeenCalled();
    });
  });

  describe('handleMessage', () => {
    test('should ignore commands starting with /', async () => {
      setupFromMock({
        telegram_sessions: () => ({
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          order: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: null, error: null })
        })
      });

      await handleMessage({ text: '/start', chat: { id: 12345 } });
      // processEditFeedback should not be called for commands
      expect(mockSendNotification).not.toHaveBeenCalled();
    });

    test('should ignore messages without text', async () => {
      await handleMessage({ chat: { id: 12345 } });
      expect(mockSendNotification).not.toHaveBeenCalled();
    });
  });
});
