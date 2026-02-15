const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { getAIProvider, getAvailableModels } = require('../services/ai-provider');
const { getCompetitorContext } = require('../services/analytics');

// POST /api/ai/generate - Generate tweet candidates
router.post('/generate', async (req, res) => {
  try {
    const { theme, postType, provider, model, accountId, includeCompetitorContext, customPrompt } = req.body;

    if (!theme) return res.status(400).json({ error: 'theme is required' });

    // Determine provider and model from account defaults or request
    let providerName = provider;
    let modelName = model;

    if (accountId) {
      const sb = getDb();
      const { data: account } = await sb.from('x_accounts')
        .select('default_ai_provider, default_ai_model')
        .eq('id', accountId)
        .single();
      if (account) {
        providerName = providerName || account.default_ai_provider;
        modelName = modelName || account.default_ai_model;
      }
    }

    if (!providerName) providerName = 'claude';

    const aiProvider = getAIProvider(providerName);

    const options = {
      postType: postType || 'new',
      model: modelName,
      accountId: accountId || null,
      customPrompt: customPrompt || '',
      competitorContext: includeCompetitorContext ? await getCompetitorContext(accountId) : ''
    };

    const result = await aiProvider.generateTweets(theme, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/ai/models - List available models for dropdown selection
router.get('/models', (req, res) => {
  try {
    res.json(getAvailableModels());
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/ai/providers - List available AI providers
router.get('/providers', (req, res) => {
  try {
    const models = getAvailableModels();
    res.json({
      providers: [
        { name: 'claude', label: models.claude.label, models: models.claude.models, available: !!process.env.CLAUDE_API_KEY },
        { name: 'gemini', label: models.gemini.label, models: models.gemini.models, available: !!process.env.GEMINI_API_KEY }
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
