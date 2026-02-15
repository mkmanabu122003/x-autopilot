const { getDb } = require('../db/database');
const { logApiUsage } = require('./x-api');

const CLAUDE_MODELS = [
  { id: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
];

const GEMINI_MODELS = [
  { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
  { id: 'gemini-2.0-flash-lite', label: 'Gemini 2.0 Flash Lite' },
  { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
  { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
];

function getAvailableModels() {
  return {
    claude: { label: 'Claude (Anthropic)', models: CLAUDE_MODELS },
    gemini: { label: 'Gemini (Google)', models: GEMINI_MODELS },
  };
}

class AIProvider {
  async generateTweets(theme, options = {}) {
    throw new Error('Not implemented');
  }

  getSystemPrompt(options = {}) {
    const db = getDb();
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('system_prompt');
    let prompt = row ? row.value : '';

    prompt = prompt.replace('{postType}', options.postType || '新規ツイート');
    prompt = prompt.replace('{userInput}', options.theme || '');
    prompt = prompt.replace('{competitorContext}', options.competitorContext || '');

    return prompt;
  }

  parseCandidates(text) {
    const candidates = [];
    const patterns = text.split(/(?:^|\n)(?:\d+[\.\)]\s*|パターン\d+[:：]\s*)/);

    for (const pattern of patterns) {
      const trimmed = pattern.trim();
      if (!trimmed) continue;

      const hashtagMatches = trimmed.match(/#[\w\u3000-\u9FFF]+/g) || [];
      candidates.push({
        text: trimmed,
        hashtags: hashtagMatches
      });
    }

    if (candidates.length === 0) {
      const hashtagMatches = text.match(/#[\w\u3000-\u9FFF]+/g) || [];
      candidates.push({ text: text.trim(), hashtags: hashtagMatches });
    }

    return candidates.slice(0, 3);
  }
}

class ClaudeProvider extends AIProvider {
  async generateTweets(theme, options = {}) {
    const model = options.model || 'claude-sonnet-4-20250514';
    const systemPrompt = this.getSystemPrompt({ ...options, theme });
    const userPrompt = options.customPrompt || `テーマ「${theme}」でツイートを3パターン作成してください。`;

    if (!process.env.CLAUDE_API_KEY) {
      throw new Error('CLAUDE_API_KEY environment variable is not set');
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Claude API error ${response.status}: ${JSON.stringify(error)}`);
    }

    const data = await response.json();
    const text = data.content[0].text;

    logApiUsage('claude', 'POST /v1/messages', 0.001, options.accountId);

    return {
      provider: 'claude',
      model,
      candidates: this.parseCandidates(text)
    };
  }
}

class GeminiProvider extends AIProvider {
  async generateTweets(theme, options = {}) {
    const model = options.model || 'gemini-2.0-flash';
    const systemPrompt = this.getSystemPrompt({ ...options, theme });
    const userPrompt = options.customPrompt || `テーマ「${theme}」でツイートを3パターン作成してください。`;
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY environment variable is not set');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: fullPrompt }] }],
        generationConfig: { maxOutputTokens: 1024 }
      })
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`Gemini API error ${response.status}: ${JSON.stringify(error)}`);
    }

    const data = await response.json();
    const text = data.candidates[0].content.parts[0].text;

    logApiUsage('gemini', `POST /models/${model}:generateContent`, 0.0002, options.accountId);

    return {
      provider: 'gemini',
      model,
      candidates: this.parseCandidates(text)
    };
  }
}

function getAIProvider(providerName) {
  switch (providerName) {
    case 'claude':
      return new ClaudeProvider();
    case 'gemini':
      return new GeminiProvider();
    default:
      throw new Error(`Unknown AI provider: ${providerName}`);
  }
}

module.exports = { getAIProvider, getAvailableModels, AIProvider, ClaudeProvider, GeminiProvider };
