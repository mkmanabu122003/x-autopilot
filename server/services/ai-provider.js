const { getDb } = require('../db/database');
const { logApiUsage } = require('./x-api');
const { logDetailedUsage, checkBudgetStatus } = require('./cost-calculator');
const defaultPrompts = require('../config/prompts');

const CLAUDE_MODELS = [
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
];

const GEMINI_MODELS = [
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
];

const DEFAULT_EFFORT_MAP = {
  competitor_analysis: 'high',
  tweet_generation: 'medium',
  comment_generation: 'low',
  quote_rt_generation: 'low',
  performance_summary: 'low'
};

const DEFAULT_MAX_TOKENS_MAP = {
  competitor_analysis: 2048,
  tweet_generation: 512,
  comment_generation: 256,
  quote_rt_generation: 256,
  performance_summary: 1024
};

function getAvailableModels() {
  return {
    claude: { label: 'Claude (Anthropic)', models: CLAUDE_MODELS },
    gemini: { label: 'Gemini (Google)', models: GEMINI_MODELS },
  };
}

class AIProvider {
  async getSystemPrompt(options = {}) {
    const sb = getDb();

    // Check for custom prompt by task type first
    if (options.taskType) {
      const { data: custom } = await sb.from('custom_prompts')
        .select('system_prompt')
        .eq('task_type', options.taskType)
        .eq('is_custom', true)
        .single();
      if (custom && custom.system_prompt) return custom.system_prompt;
    }

    // Check for task-specific default prompt
    if (options.taskType && defaultPrompts[options.taskType]) {
      return defaultPrompts[options.taskType].system;
    }

    // Fall back to the global system prompt from settings
    const { data } = await sb.from('settings').select('value').eq('key', 'system_prompt').single();
    let prompt = data ? data.value : '';
    prompt = prompt.replace('{postType}', options.postType || '新規ツイート');
    prompt = prompt.replace('{userInput}', options.theme || '');
    prompt = prompt.replace('{competitorContext}', options.competitorContext || '');
    return prompt;
  }

  async getTaskModelSettings(taskType, providerName) {
    const sb = getDb();
    const { data } = await sb.from('task_model_settings')
      .select('*')
      .eq('task_type', taskType)
      .single();

    if (data) {
      return {
        model: providerName === 'claude' ? data.claude_model : data.gemini_model,
        effort: data.effort || DEFAULT_EFFORT_MAP[taskType] || 'medium',
        maxTokens: data.max_tokens || DEFAULT_MAX_TOKENS_MAP[taskType] || 512
      };
    }

    return {
      model: null,
      effort: DEFAULT_EFFORT_MAP[taskType] || 'medium',
      maxTokens: DEFAULT_MAX_TOKENS_MAP[taskType] || 512
    };
  }

  async getCostSettings() {
    const sb = getDb();
    const { data } = await sb.from('cost_settings').select('*').limit(1).single();
    return data || {
      cache_enabled: true,
      batch_enabled: true,
      budget_pause_100: true,
      monthly_budget_usd: 33
    };
  }

  inferTaskType(postType) {
    switch (postType) {
      case 'quote': return 'quote_rt_generation';
      case 'reply': return 'comment_generation';
      case 'analysis': return 'competitor_analysis';
      case 'summary': return 'performance_summary';
      default: return 'tweet_generation';
    }
  }

  parseCandidates(text) {
    const candidates = [];
    const patterns = text.split(/(?:^|\n)(?:\d+[\.\)]\s*|パターン\d+[:：]\s*)/);
    for (const pattern of patterns) {
      const trimmed = pattern.trim();
      if (!trimmed) continue;
      const hashtagMatches = trimmed.match(/#[\w\u3000-\u9FFF]+/g) || [];
      candidates.push({ text: trimmed, hashtags: hashtagMatches });
    }
    if (candidates.length === 0) {
      const hashtagMatches = text.match(/#[\w\u3000-\u9FFF]+/g) || [];
      candidates.push({ text: text.trim(), hashtags: hashtagMatches });
    }
    return candidates.slice(0, 3);
  }
}

class ClaudeProvider extends AIProvider {
  isOpusModel(model) {
    return model && model.includes('opus');
  }

  getThinkingConfig(model) {
    if (!this.isOpusModel(model)) return undefined;
    return {
      type: 'adaptive'
    };
  }

  async generateTweets(theme, options = {}) {
    if (!process.env.CLAUDE_API_KEY) throw new Error('CLAUDE_API_KEY environment variable is not set');

    // Check budget
    const costSettings = await this.getCostSettings();
    if (costSettings.budget_pause_100) {
      const budgetStatus = await checkBudgetStatus();
      if (budgetStatus.shouldPause) {
        throw new Error('月間予算の上限に達しました。設定画面から予算を増額するか、翌月までお待ちください。');
      }
    }

    // Determine task type for model selection
    const taskType = options.taskType || this.inferTaskType(options.postType);

    // Get task-specific model settings
    const taskSettings = await this.getTaskModelSettings(taskType, 'claude');
    const model = options.model || taskSettings.model || 'claude-sonnet-4-20250514';
    const effort = options.effort || taskSettings.effort;
    const maxTokens = options.maxTokens || taskSettings.maxTokens || 1024;

    const systemPrompt = await this.getSystemPrompt({ ...options, theme, taskType });
    const userPrompt = options.customPrompt || `テーマ「${theme}」でツイートを3パターン作成してください。`;

    // Build request body
    const body = {
      model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: userPrompt }]
    };

    // Apply prompt caching if enabled
    if (costSettings.cache_enabled) {
      body.system = [{
        type: 'text',
        text: systemPrompt,
        cache_control: { type: 'ephemeral' }
      }];
    } else {
      body.system = systemPrompt;
    }

    // Apply thinking/effort config for Opus models
    const thinkingConfig = this.getThinkingConfig(model);
    if (thinkingConfig) {
      body.thinking = thinkingConfig;
    }

    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY,
      'anthropic-version': '2023-06-01'
    };

    // Enable prompt caching beta header if cache is enabled
    if (costSettings.cache_enabled) {
      headers['anthropic-beta'] = 'prompt-caching-2024-07-31';
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Claude API error ${response.status}: ${JSON.stringify(error)}`);
    }

    const data = await response.json();

    // Log detailed usage
    const usage = data.usage || {};
    await logDetailedUsage({
      provider: 'claude',
      model,
      taskType,
      inputTokens: usage.input_tokens || 0,
      outputTokens: usage.output_tokens || 0,
      thinkingTokens: 0,
      cacheReadTokens: usage.cache_read_input_tokens || 0,
      cacheWriteTokens: usage.cache_creation_input_tokens || 0,
      isBatch: false,
      requestId: data.id || null
    });

    // Also log to legacy table for backwards compatibility
    await logApiUsage('claude', 'POST /v1/messages', 0, options.accountId);

    // Extract text from response (handle thinking blocks)
    let responseText = '';
    if (Array.isArray(data.content)) {
      for (const block of data.content) {
        if (block.type === 'text') {
          responseText += block.text;
        }
      }
    }
    if (!responseText) {
      responseText = data.content?.[0]?.text || '';
    }

    return {
      provider: 'claude',
      model,
      taskType,
      usage: {
        inputTokens: usage.input_tokens || 0,
        outputTokens: usage.output_tokens || 0,
        cacheReadTokens: usage.cache_read_input_tokens || 0,
        cacheWriteTokens: usage.cache_creation_input_tokens || 0
      },
      candidates: this.parseCandidates(responseText)
    };
  }
}

class GeminiProvider extends AIProvider {
  async generateTweets(theme, options = {}) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY environment variable is not set');

    // Check budget
    const costSettings = await this.getCostSettings();
    if (costSettings.budget_pause_100) {
      const budgetStatus = await checkBudgetStatus();
      if (budgetStatus.shouldPause) {
        throw new Error('月間予算の上限に達しました。設定画面から予算を増額するか、翌月までお待ちください。');
      }
    }

    const taskType = options.taskType || this.inferTaskType(options.postType);
    const taskSettings = await this.getTaskModelSettings(taskType, 'gemini');
    const model = options.model || taskSettings.model || 'gemini-2.0-flash';
    const maxTokens = options.maxTokens || taskSettings.maxTokens || 1024;

    const systemPrompt = await this.getSystemPrompt({ ...options, theme, taskType });
    const userPrompt = options.customPrompt || `テーマ「${theme}」でツイートを3パターン作成してください。`;
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { maxOutputTokens: maxTokens }
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Gemini API error ${response.status}: ${JSON.stringify(error)}`);
    }

    const data = await response.json();

    // Extract token usage from Gemini response
    const usageMetadata = data.usageMetadata || {};
    const inputTokens = usageMetadata.promptTokenCount || 0;
    const outputTokens = usageMetadata.candidatesTokenCount || 0;

    await logDetailedUsage({
      provider: 'gemini',
      model,
      taskType,
      inputTokens,
      outputTokens,
      isBatch: false
    });

    // Legacy logging
    await logApiUsage('gemini', `POST /models/${model}:generateContent`, 0, options.accountId);

    return {
      provider: 'gemini',
      model,
      taskType,
      usage: { inputTokens, outputTokens },
      candidates: this.parseCandidates(data.candidates[0].content.parts[0].text)
    };
  }
}

function getAIProvider(providerName) {
  switch (providerName) {
    case 'claude': return new ClaudeProvider();
    case 'gemini': return new GeminiProvider();
    default: throw new Error(`Unknown AI provider: ${providerName}`);
  }
}

module.exports = { getAIProvider, getAvailableModels, AIProvider, ClaudeProvider, GeminiProvider };
