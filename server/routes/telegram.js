const express = require('express');
const router = express.Router();
const { triggerTweetProposal } = require('../services/telegram-workflow');
const { getBot, sendNotification } = require('../services/telegram-bot');

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
    const chatId = req.body.chatId || process.env.TELEGRAM_CHAT_ID;
    if (!chatId) return res.status(400).json({ error: 'chatId or TELEGRAM_CHAT_ID is required' });

    const sent = await sendNotification(chatId, '🤖 X AutoPilot テスト通知\n\nTelegram連携が正常に動作しています。');
    if (!sent) {
      return res.status(500).json({ error: 'Bot not initialized' });
    }

    res.json({ success: true, messageId: sent.message_id });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
