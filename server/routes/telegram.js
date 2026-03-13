const express = require('express');
const router = express.Router();
const { triggerTweetProposal } = require('../services/telegram-workflow');
const { getBot, sendNotification, getTelegramChatId, reloadBot } = require('../services/telegram-bot');
const { getDb } = require('../db/database');
const { encrypt } = require('../utils/crypto');

// POST /api/telegram/trigger - Manually trigger tweet proposal generation & send to Telegram
router.post('/trigger', async (req, res) => {
  try {
    const { accountId, theme, postType, aiProvider, aiModel } = req.body;
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });

    const result = await triggerTweetProposal(accountId, {
      theme,
      postType,
      aiProvider,
      aiModel
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/telegram/status - Check bot connection status
router.get('/status', async (req, res) => {
  try {
    const bot = getBot();
    if (!bot) {
      return res.json({ connected: false, reason: 'Bot not initialized' });
    }

    const me = await bot.getMe();
    res.json({
      connected: true,
      bot: {
        id: me.id,
        username: me.username,
        first_name: me.first_name
      }
    });
  } catch (error) {
    res.json({ connected: false, reason: error.message });
  }
});

// POST /api/telegram/test - Send a test message
router.post('/test', async (req, res) => {
  try {
    const chatId = req.body.chatId || getTelegramChatId();
    if (!chatId) return res.status(400).json({ error: 'chatId が未指定です。settings テーブルに telegram_chat_id を登録してください。' });

    const sent = await sendNotification(chatId, '🤖 X AutoPilot テスト通知\n\nTelegram連携が正常に動作しています。');
    if (!sent) {
      return res.status(500).json({ error: 'Bot not initialized' });
    }

    res.json({ success: true, messageId: sent.message_id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/telegram/reload - Reload bot with fresh credentials from DB
router.post('/reload', async (req, res) => {
  try {
    const bot = await reloadBot();
    if (bot) {
      const me = await bot.getMe();
      res.json({ success: true, bot: { id: me.id, username: me.username } });
    } else {
      res.json({ success: true, bot: null, message: 'Bot token が未設定です' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/telegram/settings - Save Telegram credentials and reload bot
router.post('/settings', async (req, res) => {
  try {
    const { telegram_bot_token, telegram_chat_id } = req.body;
    if (!telegram_bot_token && !telegram_chat_id) {
      return res.status(400).json({ error: 'telegram_bot_token または telegram_chat_id を指定してください' });
    }

    const sb = getDb();
    const rows = [];
    if (telegram_bot_token !== undefined) {
      let tokenValue;
      try {
        tokenValue = encrypt(telegram_bot_token);
      } catch (e) {
        if (e.message.includes('ENCRYPTION_KEY')) {
          return res.status(500).json({ error: 'ENCRYPTION_KEY 環境変数が設定されていません。サーバーの .env に ENCRYPTION_KEY を追加してください。' });
        }
        throw e;
      }
      rows.push({ key: 'telegram_bot_token', value: tokenValue });
    }
    if (telegram_chat_id !== undefined) {
      rows.push({ key: 'telegram_chat_id', value: String(telegram_chat_id) });
    }

    const { error } = await sb.from('settings').upsert(rows, { onConflict: 'key' });
    if (error) throw error;

    // Auto-reload bot with new credentials
    const bot = await reloadBot();
    const botInfo = bot ? await bot.getMe().catch(() => null) : null;

    res.json({
      success: true,
      botReloaded: !!bot,
      bot: botInfo ? { id: botInfo.id, username: botInfo.username } : null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
