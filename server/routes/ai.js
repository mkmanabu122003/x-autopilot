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

// POST /api/ai/regenerate - Regenerate a draft tweet with feedback
router.post('/regenerate', async (req, res) => {
  try {
    const { originalText, feedback, postType, provider, model, accountId } = req.body;

    if (!originalText) return res.status(400).json({ error: 'originalText is required' });
    if (!feedback) return res.status(400).json({ error: 'feedback is required' });

    let providerName = provider;
    let modelName = model;

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

    const regeneratePrompt = `以下の既存ツイートに対して、ユーザーからフィードバックがありました。
フィードバックを反映して改善版を3パターン生成してください。

# 元のツイート
${originalText}

# ユーザーからのフィードバック
${feedback}

# 指示
- フィードバックの内容を正確に反映すること
- 元のツイートの良い部分は維持しつつ改善すること
- 3案それぞれ異なるアプローチで改善すること`;

    const options = {
      postType: postType || 'new',
      model: modelName,
      accountId: accountId || null,
      customPrompt: regeneratePrompt
    };

    const result = await aiProvider.generateTweets('フィードバック再生成', options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/ai/decompose-feedback - Decompose feedback history into selectable atomic rules
router.post('/decompose-feedback', async (req, res) => {
  try {
    const { feedbackHistory, provider, model, accountId } = req.body;

    if (!feedbackHistory || !Array.isArray(feedbackHistory) || feedbackHistory.length === 0) {
      return res.status(400).json({ error: 'feedbackHistory is required (array of strings)' });
    }

    let providerName = provider;
    let modelName = model;

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

    const decomposePrompt = `以下はユーザーがツイートの改善時に与えたフィードバック履歴です。
これらのフィードバックを、今後のツイート生成プロンプトに恒久的に追加できる「ルール」に分解してください。

# フィードバック履歴
${feedbackHistory.map((f, i) => `${i + 1}. ${f}`).join('\n')}

# 指示
- 各フィードバックから汎用的なルールを抽出する
- 具体的すぎる内容は一般化する（例:「この単語を変えて」→「カジュアルな表現を使う」）
- 重複するルールは統合する
- カテゴリ分け: content（内容）, tone（トーン）, structure（構造）, style（文体）
- 3〜8個のルールに整理する

# 出力形式
JSON形式で返してください。コードフェンスは付けないこと。
{"rules":[{"text":"ルールの内容","category":"content|tone|structure|style"}]}`;

    const result = await aiProvider.generateTweets('フィードバック分解', {
      postType: 'new',
      model: modelName,
      accountId: accountId || null,
      customPrompt: decomposePrompt,
      taskType: 'tweet_generation'
    });

    // Parse the AI response to extract rules
    const responseText = result.candidates?.[0]?.text || '';
    let rules = [];

    try {
      const cleaned = responseText.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      if (parsed.rules && Array.isArray(parsed.rules)) {
        rules = parsed.rules.map(r => ({
          text: r.text || '',
          category: ['content', 'tone', 'structure', 'style'].includes(r.category) ? r.category : 'content'
        })).filter(r => r.text);
      }
    } catch (e) {
      try {
        const jsonMatch = responseText.match(/\{[\s\S]*"rules"[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.rules && Array.isArray(parsed.rules)) {
            rules = parsed.rules.map(r => ({
              text: r.text || '',
              category: ['content', 'tone', 'structure', 'style'].includes(r.category) ? r.category : 'content'
            })).filter(r => r.text);
          }
        }
      } catch (e2) {
        // fallback: return raw text as a single rule
        if (responseText.trim()) {
          rules = [{ text: responseText.trim().substring(0, 200), category: 'content' }];
        }
      }
    }

    res.json({ rules, rawResponse: responseText });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/ai/prompt-rules - Get all prompt feedback rules for an account
router.get('/prompt-rules', async (req, res) => {
  try {
    const sb = getDb();
    const accountId = req.query.accountId;

    let query = sb.from('prompt_feedback_rules')
      .select('*')
      .order('created_at', { ascending: false });

    if (accountId) query = query.eq('account_id', accountId);

    const { data, error } = await query;
    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/ai/prompt-rules - Save prompt feedback rules
router.post('/prompt-rules', async (req, res) => {
  try {
    const { rules, accountId, sourceFeedback } = req.body;
    if (!rules || !Array.isArray(rules) || rules.length === 0) {
      return res.status(400).json({ error: 'rules is required (array)' });
    }
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });

    const sb = getDb();
    const rows = rules.map(r => ({
      account_id: accountId,
      rule_text: r.text,
      category: r.category || 'content',
      source_feedback: sourceFeedback || null,
      enabled: true
    }));

    const { data, error } = await sb.from('prompt_feedback_rules')
      .insert(rows)
      .select('*');
    if (error) throw error;

    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/ai/prompt-rules/:id - Toggle or update a prompt rule
router.put('/prompt-rules/:id', async (req, res) => {
  try {
    const { enabled, rule_text } = req.body;
    const updates = {};
    if (typeof enabled === 'boolean') updates.enabled = enabled;
    if (rule_text) updates.rule_text = rule_text;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const sb = getDb();
    const { data, error } = await sb.from('prompt_feedback_rules')
      .update(updates)
      .eq('id', req.params.id)
      .select('*');
    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Rule not found' });
    }
    res.json(data[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/ai/prompt-rules/:id - Delete a prompt rule
router.delete('/prompt-rules/:id', async (req, res) => {
  try {
    const sb = getDb();
    const { data, error } = await sb.from('prompt_feedback_rules')
      .delete()
      .eq('id', req.params.id)
      .select('id');
    if (error) throw error;

    if (!data || data.length === 0) {
      return res.status(404).json({ error: 'Rule not found' });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
