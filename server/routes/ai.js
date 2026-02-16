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

    // Build quote-specific prompt if targetTweetText and quoteAngle are provided
    let quotePrompt = customPrompt || '';
    const { targetTweetText, targetHandle, quoteAngle } = req.body;
    if (postType === 'quote' && targetTweetText) {
      const angleLabels = {
        agree: '同意+補足（共感しつつ自分の知見を追加）',
        counter: '反論（別の視点を提示）',
        question: '質問（議論を促す問いかけ）',
        experience: '体験談（自身の経験を交えたコメント）',
        data: 'データ補足（数字や事実で補強）',
      };
      const angleDesc = angleLabels[quoteAngle] || '自由なアングル';
      quotePrompt = `以下のツイートを引用RTするコメントを3パターン作成してください。

引用元ツイート（@${targetHandle || '不明'}）:
「${targetTweetText}」

アングル: ${angleDesc}

- 引用元の内容を踏まえた上で、独自の視点やコメントを加えてください
- 280文字以内（日本語の場合は140文字を目安に）
- ハッシュタグは2-3個
- エンゲージメントを高める工夫を含めてください`;
    }

    const options = {
      postType: postType || 'new',
      model: modelName,
      accountId: accountId || null,
      customPrompt: quotePrompt,
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
