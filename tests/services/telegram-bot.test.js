// Mock node-telegram-bot-api
const mockSendMessage = jest.fn();
const mockEditMessageText = jest.fn();
const mockAnswerCallbackQuery = jest.fn();
const mockStopPolling = jest.fn();
const mockGetMe = jest.fn();
const mockOn = jest.fn();

jest.mock('node-telegram-bot-api', () => {
  return jest.fn().mockImplementation(() => ({
    sendMessage: mockSendMessage,
    editMessageText: mockEditMessageText,
    answerCallbackQuery: mockAnswerCallbackQuery,
    stopPolling: mockStopPolling,
    getMe: mockGetMe,
    on: mockOn
  }));
});

// Mock database for loadTelegramCredentials
jest.mock('../../server/db/database', () => ({
  getDb: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      in: jest.fn().mockResolvedValue({ data: [] })
    }))
  }))
}));

// Mock app-logger
jest.mock('../../server/services/app-logger', () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn()
}));

const TelegramBot = require('node-telegram-bot-api');
const telegramBot = require('../../server/services/telegram-bot');

describe('telegram-bot', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.TELEGRAM_CHAT_ID = '12345';
    // Reset bot state by stopping any existing bot
    await telegramBot.stopBot().catch(() => {});
  });

  afterEach(() => {
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
  });

  describe('initTelegramBot', () => {
    test('should initialize bot when token is set', async () => {
      const bot = await telegramBot.initTelegramBot();

      expect(TelegramBot).toHaveBeenCalledWith('test-token', { polling: true });
      expect(bot).toBeTruthy();
      expect(mockOn).toHaveBeenCalledWith('callback_query', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('polling_error', expect.any(Function));
    });

    test('should return null when token is not set', async () => {
      delete process.env.TELEGRAM_BOT_TOKEN;
      const bot = await telegramBot.initTelegramBot();

      expect(bot).toBeNull();
    });
  });

  describe('isAuthorizedChat', () => {
    test('should authorize matching chat ID after init', async () => {
      await telegramBot.initTelegramBot();
      expect(telegramBot.isAuthorizedChat(12345)).toBe(true);
      expect(telegramBot.isAuthorizedChat('12345')).toBe(true);
    });

    test('should reject non-matching chat ID', async () => {
      await telegramBot.initTelegramBot();
      expect(telegramBot.isAuthorizedChat(99999)).toBe(false);
    });

    test('should allow all when TELEGRAM_CHAT_ID is not set', async () => {
      delete process.env.TELEGRAM_CHAT_ID;
      await telegramBot.initTelegramBot();
      expect(telegramBot.isAuthorizedChat(99999)).toBe(true);
    });
  });

  describe('sendTweetProposal', () => {
    test('should send message with inline keyboard', async () => {
      await telegramBot.initTelegramBot();
      mockSendMessage.mockResolvedValue({ message_id: 100 });

      const result = await telegramBot.sendTweetProposal('12345', {
        postId: 'post-1',
        text: 'テストツイート',
        index: 1,
        total: 3,
        postType: 'new'
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '12345',
        expect.stringContaining('ツイート案 (1/3)'),
        expect.objectContaining({
          reply_markup: expect.objectContaining({
            inline_keyboard: expect.arrayContaining([
              expect.arrayContaining([
                expect.objectContaining({ callback_data: 'approve:post-1' }),
                expect.objectContaining({ callback_data: 'edit:post-1' })
              ])
            ])
          })
        })
      );
      expect(result.message_id).toBe(100);
    });

    test('should return null when bot is not initialized', async () => {
      // Don't initialize bot
      const result = await telegramBot.sendTweetProposal('12345', {
        postId: 'post-1',
        text: 'test',
        index: 1,
        total: 1,
        postType: 'new'
      });
      expect(result).toBeNull();
    });

    test('should show correct type label for reply', async () => {
      await telegramBot.initTelegramBot();
      mockSendMessage.mockResolvedValue({ message_id: 101 });

      await telegramBot.sendTweetProposal('12345', {
        postId: 'post-2',
        text: 'リプライテスト',
        index: 1,
        total: 1,
        postType: 'reply'
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '12345',
        expect.stringContaining('リプライ案'),
        expect.any(Object)
      );
    });

    test('should show correct type label for quote', async () => {
      await telegramBot.initTelegramBot();
      mockSendMessage.mockResolvedValue({ message_id: 102 });

      await telegramBot.sendTweetProposal('12345', {
        postId: 'post-3',
        text: '引用RTテスト',
        index: 1,
        total: 1,
        postType: 'quote'
      });

      expect(mockSendMessage).toHaveBeenCalledWith(
        '12345',
        expect.stringContaining('引用RT案'),
        expect.any(Object)
      );
    });
  });

  describe('sendNotification', () => {
    test('should send text message', async () => {
      await telegramBot.initTelegramBot();
      mockSendMessage.mockResolvedValue({ message_id: 200 });

      const result = await telegramBot.sendNotification('12345', 'テスト通知');
      expect(mockSendMessage).toHaveBeenCalledWith('12345', 'テスト通知');
      expect(result.message_id).toBe(200);
    });
  });

  describe('updateMessage', () => {
    test('should edit existing message', async () => {
      await telegramBot.initTelegramBot();
      mockEditMessageText.mockResolvedValue({});

      await telegramBot.updateMessage('12345', 100, '更新テキスト');
      expect(mockEditMessageText).toHaveBeenCalledWith('更新テキスト', {
        chat_id: '12345',
        message_id: 100
      });
    });
  });

  describe('stopBot', () => {
    test('should stop polling', async () => {
      await telegramBot.initTelegramBot();
      mockStopPolling.mockResolvedValue();

      await telegramBot.stopBot();
      expect(mockStopPolling).toHaveBeenCalled();
      expect(telegramBot.getBot()).toBeNull();
    });
  });

  describe('loadTelegramCredentials', () => {
    test('should fall back to env vars when DB returns empty', async () => {
      const result = await telegramBot.loadTelegramCredentials();
      expect(result.token).toBe('test-token');
      expect(result.chatId).toBe('12345');
    });

    test('should return null when no credentials available', async () => {
      delete process.env.TELEGRAM_BOT_TOKEN;
      delete process.env.TELEGRAM_CHAT_ID;
      const result = await telegramBot.loadTelegramCredentials();
      expect(result.token).toBeNull();
      expect(result.chatId).toBeNull();
    });
  });

  describe('getTelegramChatId', () => {
    test('should return chat ID after init', async () => {
      await telegramBot.initTelegramBot();
      expect(telegramBot.getTelegramChatId()).toBe('12345');
    });
  });
});
