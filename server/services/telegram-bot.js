const TelegramBot = require('node-telegram-bot-api');
const { logError, logInfo } = require('./app-logger');

let bot = null;
let callbackHandler = null;
let messageHandler = null;
let telegramChatId = null;

/**
 * Load Telegram credentials from the settings table.
 * Falls back to environment variables for backwards compatibility.
 * @returns {{ token: string|null, chatId: string|null }}
 */
async function loadTelegramCredentials() {
  try {
    const { getDb } = require('../db/database');
    const sb = getDb();
    const { data: rows } = await sb.from('settings')
      .select('key, value')
      .in('key', ['telegram_bot_token', 'telegram_chat_id']);

    const settings = {};
    if (rows) {
      for (const row of rows) {
        settings[row.key] = row.value;
      }
    }

    let token = settings.telegram_bot_token || process.env.TELEGRAM_BOT_TOKEN || null;
    const chatId = settings.telegram_chat_id || process.env.TELEGRAM_CHAT_ID || null;

    // Decrypt token if it was encrypted (stored from PUT /api/telegram/settings)
    if (token && settings.telegram_bot_token) {
      try {
        const { decrypt } = require('../utils/crypto');
        token = decrypt(token);
      } catch (e) {
        // Not encrypted or ENCRYPTION_KEY not set — use as-is (env var fallback)
      }
    }

    return { token, chatId };
  } catch (err) {
    // DB not available yet, fall back to env vars
    return {
      token: process.env.TELEGRAM_BOT_TOKEN || null,
      chatId: process.env.TELEGRAM_CHAT_ID || null
    };
  }
}

/**
 * Initialize the Telegram bot with polling mode.
 * Loads credentials from DB (settings table), falling back to env vars.
 * @param {object} handlers - { onCallback, onMessage }
 * @returns {Promise<TelegramBot|null>}
 */
async function initTelegramBot(handlers = {}) {
  const { token, chatId } = await loadTelegramCredentials();
  telegramChatId = chatId;

  if (!token) {
    logInfo('telegram', 'Bot token not configured, skipping initialization');
    return null;
  }

  bot = new TelegramBot(token, { polling: true });
  callbackHandler = handlers.onCallback || null;
  messageHandler = handlers.onMessage || null;

  bot.on('callback_query', async (query) => {
    try {
      if (!isAuthorizedChat(query.message.chat.id)) {
        await bot.answerCallbackQuery(query.id, { text: '権限がありません' });
        return;
      }
      if (callbackHandler) {
        await callbackHandler(query);
      }
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      logError('telegram', 'コールバック処理エラー', { error: err.message });
      try {
        await bot.answerCallbackQuery(query.id, { text: 'エラーが発生しました' });
      } catch (e) {
        // ignore
      }
    }
  });

  bot.on('message', async (msg) => {
    try {
      if (!isAuthorizedChat(msg.chat.id)) return;
      if (messageHandler) {
        await messageHandler(msg);
      }
    } catch (err) {
      logError('telegram', 'メッセージ処理エラー', { error: err.message });
    }
  });

  bot.on('polling_error', (err) => {
    logError('telegram', 'ポーリングエラー', { error: err.message });
  });

  logInfo('telegram', 'Telegram Bot を起動しました');
  return bot;
}

/**
 * Check if the chat ID is authorized.
 */
function isAuthorizedChat(chatId) {
  const allowed = telegramChatId || process.env.TELEGRAM_CHAT_ID;
  if (!allowed) return true; // If not configured, allow all
  return String(chatId) === String(allowed);
}

/**
 * Get the configured Telegram chat ID.
 */
function getTelegramChatId() {
  return telegramChatId || process.env.TELEGRAM_CHAT_ID || null;
}

/**
 * Send a tweet proposal to Telegram with inline keyboard buttons.
 * @param {string} chatId
 * @param {object} proposal - { postId, text, index, total, postType }
 * @returns {object|null} sent message
 */
async function sendTweetProposal(chatId, proposal) {
  if (!bot) return null;

  const { postId, text, index, total, postType, factCheck } = proposal;
  const typeLabel = postType === 'reply' ? 'リプライ' : postType === 'quote' ? '引用RT' : 'ツイート';
  const charCount = text.length;

  let factCheckLine = '';
  if (factCheck && factCheck !== 'ok') {
    factCheckLine = `\n⚠️ 要確認: ${factCheck}`;
  }

  const message = `📝 ${typeLabel}案 (${index}/${total})\n━━━━━━━━━━━━━━━━\n${text}\n━━━━━━━━━━━━━━━━\n📊 文字数: ${charCount}${factCheckLine}`;

  const keyboard = {
    inline_keyboard: [[
      { text: '✅ これで投稿', callback_data: `approve:${postId}` },
      { text: '✏️ 編集依頼', callback_data: `edit:${postId}` }
    ], [
      { text: '🔄 再生成', callback_data: `regenerate:${postId}` },
      { text: '❌ 却下', callback_data: `reject:${postId}` }
    ]]
  };

  const sent = await bot.sendMessage(chatId, message, {
    reply_markup: keyboard,
    parse_mode: undefined // Plain text to avoid markdown escaping issues
  });

  return sent;
}

/**
 * Send a simple notification message.
 * @param {string} chatId
 * @param {string} text
 */
async function sendNotification(chatId, text) {
  if (!bot) return null;
  return bot.sendMessage(chatId, text);
}

/**
 * Update an existing message (e.g., after approve/reject).
 * @param {string} chatId
 * @param {number} messageId
 * @param {string} text
 */
async function updateMessage(chatId, messageId, text) {
  if (!bot) return null;
  return bot.editMessageText(text, { chat_id: chatId, message_id: messageId });
}

/**
 * Get the bot instance.
 */
function getBot() {
  return bot;
}

/**
 * Stop the bot (for graceful shutdown / testing).
 */
async function stopBot() {
  if (bot) {
    await bot.stopPolling();
    bot = null;
  }
}

/**
 * Reload the bot with fresh credentials from the database.
 * Stops the current bot instance, reloads credentials, and re-initializes.
 * @returns {Promise<TelegramBot|null>}
 */
async function reloadBot() {
  logInfo('telegram', 'Bot の認証情報を再読み込みします');
  await stopBot();

  const { token, chatId } = await loadTelegramCredentials();
  telegramChatId = chatId;

  if (!token) {
    logInfo('telegram', 'Bot token が未設定のため、再初期化をスキップしました');
    return null;
  }

  bot = new TelegramBot(token, { polling: true });

  bot.on('callback_query', async (query) => {
    try {
      if (!isAuthorizedChat(query.message.chat.id)) {
        await bot.answerCallbackQuery(query.id, { text: '権限がありません' });
        return;
      }
      if (callbackHandler) {
        await callbackHandler(query);
      }
      await bot.answerCallbackQuery(query.id);
    } catch (err) {
      logError('telegram', 'コールバック処理エラー', { error: err.message });
      try {
        await bot.answerCallbackQuery(query.id, { text: 'エラーが発生しました' });
      } catch (e) {
        // ignore
      }
    }
  });

  bot.on('message', async (msg) => {
    try {
      if (!isAuthorizedChat(msg.chat.id)) return;
      if (messageHandler) {
        await messageHandler(msg);
      }
    } catch (err) {
      logError('telegram', 'メッセージ処理エラー', { error: err.message });
    }
  });

  bot.on('polling_error', (err) => {
    logError('telegram', 'ポーリングエラー', { error: err.message });
  });

  logInfo('telegram', 'Bot を再初期化しました');
  return bot;
}

module.exports = {
  initTelegramBot,
  loadTelegramCredentials,
  reloadBot,
  sendTweetProposal,
  sendNotification,
  updateMessage,
  getBot,
  stopBot,
  isAuthorizedChat,
  getTelegramChatId
};
