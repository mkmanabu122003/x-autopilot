const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const { getAIProvider, getAvailableModels, AIProvider } = require('../services/ai-provider');
const { getCompetitorContext } = require('../services/analytics');

// POST /api/ai/generate - Generate tweet candidates
router.post('/generate', async (req, res) => {
  try {
    const { theme, postType, provider, model, accountId, includeCompetitorContext, customPrompt } = req.body;

    if (!theme) return res.status(400).json({ error: 'theme is required' });

    // Determine provider and model
    // Priority: explicit request > task-level setting > account default > 'claude'
    let providerName = provider;
    let modelName = model;

    // Check task-level preferred provider (if no explicit provider in request)
    if (!providerName) {
      const baseProvider = new AIProvider();
      const taskType = baseProvider.inferTaskType(postType || 'new');
      const taskSettings = await baseProvider.getTaskModelSettings(taskType, 'claude');
      if (taskSettings.preferredProvider) {
        providerName = taskSettings.preferredProvider;
        // Also use the corresponding model for the preferred provider
        const fullSettings = await baseProvider.getTaskModelSettings(taskType, providerName);
        if (!modelName && fullSettings.model) {
          modelName = fullSettings.model;
        }
      }
    }

    // Fall back to account defaults
    if (!providerName && accountId) {
      const sb = getDb();
      const { data: account } = await sb.from('x_accounts')
        .select('default_ai_provider, default_ai_model')
        .eq('id', accountId)
        .single();
      if (account) {
        providerName = account.default_ai_provider;
        modelName = modelName || account.default_ai_model;
      }
    }

    if (!providerName) providerName = 'claude';

    const aiProvider = getAIProvider(providerName);

    // Build quote/reply-specific prompt if targetTweetText and angle are provided
    let quotePrompt = customPrompt || '';
    const { targetTweetText, targetHandle, quoteAngle, replyAngle } = req.body;
    if (postType === 'quote' && targetTweetText) {
      const angleLabels = {
        agree: '共感',
        counter: '反論',
        question: '質問',
        experience: '体験談',
        data: 'データ補足',
      };
      const stance = angleLabels[quoteAngle] || '特になし';
      quotePrompt = `以下の元ツイートに対する引用リツイートを生成してください。

# 元ツイート
投稿者：@${targetHandle || '不明'}
内容：
${targetTweetText}

# 補足情報
- 希望するスタンス：${stance}

上記をもとに、2〜3案を生成してください。`;
    } else if (postType === 'reply' && targetTweetText) {
      const replyAngleLabels = {
        empathy: '共感+実体験',
        info: '補足情報',
        question: '質問',
        episode: 'エピソード共有',
        support: '応援・共鳴',
        perspective: '別視点提示',
      };
      const stance = replyAngleLabels[replyAngle] || '特になし';
      quotePrompt = `以下の元ツイートに対するリプライを生成してください。

# 元ツイート
投稿者：@${targetHandle || '不明'}
内容：
${targetTweetText}

# 補足情報
- 希望するアングル：${stance}

上記をもとに、2〜3案を生成してください。`;
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
