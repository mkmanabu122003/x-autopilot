const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { getAIProvider } = require('../services/ai-provider');
const { getCompetitorContext } = require('../services/analytics');

// POST /api/ai/generate - Generate tweet candidates
router.post('/generate', async (req, res) => {
  try {
    const { theme, postType, provider, includeCompetitorContext, customPrompt } = req.body;

    if (!theme) {
      return res.status(400).json({ error: 'theme is required' });
    }

    const db = getDb();
    const providerName = provider ||
      (db.prepare('SELECT value FROM settings WHERE key = ?').get('default_ai_provider')?.value) ||
      'claude';

    const aiProvider = getAIProvider(providerName);

    const options = {
      postType: postType || 'new',
      customPrompt: customPrompt || '',
      competitorContext: includeCompetitorContext ? getCompetitorContext() : ''
    };

    const result = await aiProvider.generateTweets(theme, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/ai/providers - List available AI providers
router.get('/providers', (req, res) => {
  try {
    const db = getDb();
    const defaultProvider = db.prepare('SELECT value FROM settings WHERE key = ?').get('default_ai_provider');
    const claudeModel = db.prepare('SELECT value FROM settings WHERE key = ?').get('claude_model');
    const geminiModel = db.prepare('SELECT value FROM settings WHERE key = ?').get('gemini_model');

    res.json({
      default: defaultProvider ? defaultProvider.value : 'claude',
      providers: [
        {
          name: 'claude',
          label: 'Claude (Anthropic)',
          model: claudeModel ? claudeModel.value : 'claude-sonnet-4-20250514',
          available: !!process.env.CLAUDE_API_KEY
        },
        {
          name: 'gemini',
          label: 'Gemini (Google)',
          model: geminiModel ? geminiModel.value : 'gemini-2.0-flash',
          available: !!process.env.GEMINI_API_KEY
        }
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
