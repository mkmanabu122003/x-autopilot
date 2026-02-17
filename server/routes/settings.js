const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const defaultPrompts = require('../config/prompts');

// Helper: detect "table not found" errors from Supabase
function isTableNotFound(error) {
  if (!error) return false;
  const msg = error.message || String(error);
  return msg.includes('schema cache') || msg.includes('relation') || msg.includes('does not exist');
}

// Allowed settings keys for PUT /api/settings validation
const ALLOWED_SETTINGS_KEYS = [
  'system_prompt', 'default_hashtags', 'confirm_before_post',
  'competitor_fetch_interval', 'competitor_max_accounts', 'monthly_budget_usd',
  'budget_x_api_usd', 'budget_gemini_usd', 'budget_claude_usd'
];

// Valid task types for prompt/model endpoints
const VALID_TASK_TYPES = [
  'tweet_generation', 'comment_generation', 'quote_rt_generation',
  'competitor_analysis', 'performance_summary'
];

// Cost settings defaults
const COST_DEFAULTS = {
  monthly_budget_usd: 33,
  budget_alert_80: true,
  budget_pause_100: true,
  batch_enabled: true,
  cache_enabled: true,
  batch_schedule_hour: 3
};

const COST_KEYS = Object.keys(COST_DEFAULTS);

// Cost KV key names for settings table fallback
const COST_KV_KEYS = [
  'cost_monthly_budget_usd', 'cost_budget_alert_80', 'cost_budget_pause_100',
  'cost_batch_enabled', 'cost_cache_enabled', 'cost_batch_schedule_hour'
];

// Fallback: read cost settings from the settings key-value table
async function getCostSettingsFromKV(sb) {
  const { data } = await sb.from('settings').select('key, value').in('key', COST_KV_KEYS).limit(20);
  return parseCostKVRows(data);
}

function parseCostKVRows(data) {
  const result = { ...COST_DEFAULTS };
  const rows = data || [];
  for (let i = 0; i < rows.length; i++) {
    const key = rows[i].key.replace('cost_', '');
    if (rows[i].value === 'true') result[key] = true;
    else if (rows[i].value === 'false') result[key] = false;
    else if (!isNaN(Number(rows[i].value))) result[key] = Number(rows[i].value);
    else result[key] = rows[i].value;
  }
  return result;
}

// Fallback: save cost settings to the settings key-value table (batch)
function buildCostKVRows(updates) {
  const rows = [];
  for (let i = 0; i < COST_KEYS.length; i++) {
    if (updates[COST_KEYS[i]] !== undefined) {
      rows.push({ key: `cost_${COST_KEYS[i]}`, value: String(updates[COST_KEYS[i]]) });
    }
  }
  return rows;
}

async function saveCostSettingsToKV(sb, updates) {
  const rows = buildCostKVRows(updates);
  if (rows.length > 0) {
    const { error } = await sb.from('settings').upsert(rows, { onConflict: 'key' });
    if (error) throw error;
  }
}

// Helper: load task model settings from KV fallback
async function loadTaskModelKVRows(sb, defaults) {
  const taskTypes = Object.keys(defaults);
  const kvKeys = [];
  for (let i = 0; i < taskTypes.length; i++) {
    kvKeys.push(`task_model_${taskTypes[i]}`);
  }
  const { data } = await sb.from('settings').select('key, value').in('key', kvKeys).limit(20);
  const parsed = [];
  for (let i = 0; i < (data || []).length; i++) {
    try { parsed.push(JSON.parse(data[i].value)); } catch (e) { /* ignore */ }
  }
  return parsed;
}

// GET /api/settings - Get all settings
router.get('/', async (req, res) => {
  try {
    const sb = getDb();
    const { data, error } = await sb.from('settings').select('key, value').limit(100);
    if (error) throw error;

    const settings = {};
    for (const row of (data || [])) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/settings - Update settings
router.put('/', async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }

    // Build rows from allowed keys only
    const rows = [];
    for (let i = 0; i < ALLOWED_SETTINGS_KEYS.length; i++) {
      const key = ALLOWED_SETTINGS_KEYS[i];
      if (body[key] !== undefined) {
        rows.push({ key, value: String(body[key]) });
      }
    }

    if (rows.length > 0) {
      const sb = getDb();
      const { error } = await sb.from('settings').upsert(rows, { onConflict: 'key' });
      if (error) throw error;
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/settings/usage - API usage summary (legacy)
router.get('/usage', async (req, res) => {
  try {
    const sb = getDb();
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Fetch usage rows this month (capped for safety)
    const { data: usageRows, error: usageError } = await sb.from('api_usage_log')
      .select('api_type, cost_usd, created_at')
      .gte('created_at', startOfMonth)
      .limit(10000);
    if (usageError) throw usageError;

    // Map api_type to category: x_write/x_read/x_user/x_search -> 'x', claude -> 'claude', gemini -> 'gemini'
    const toCategory = (apiType) => {
      if (apiType && apiType.startsWith('x_')) return 'x';
      return apiType || 'other';
    };

    // Labels for breakdown items
    const BREAKDOWN_LABELS = {
      x_write: '投稿 (Write)', x_read: '取得 (Read)', x_search: '検索 (Search)',
      x_user: 'ユーザー情報', x_dm: 'DM', x_media: 'メディア',
    };

    // Aggregate by category and day, and track breakdowns
    const byCategoryMap = {};
    const breakdownMap = {}; // category -> { subkey -> { key, label, call_count, total_cost } }
    let totalCost = 0;
    const dailyMap = {};

    for (const row of (usageRows || [])) {
      const cat = toCategory(row.api_type);
      if (!byCategoryMap[cat]) {
        byCategoryMap[cat] = { category: cat, call_count: 0, total_cost: 0 };
      }
      byCategoryMap[cat].call_count++;
      byCategoryMap[cat].total_cost += row.cost_usd || 0;

      totalCost += row.cost_usd || 0;

      const dateKey = row.created_at ? row.created_at.substring(0, 10) : 'unknown';
      if (!dailyMap[dateKey]) dailyMap[dateKey] = 0;
      dailyMap[dateKey] += row.cost_usd || 0;

      // Breakdown tracking (by api_type for X, by api_type for others)
      const subkey = row.api_type || 'unknown';
      if (!breakdownMap[cat]) breakdownMap[cat] = {};
      if (!breakdownMap[cat][subkey]) {
        breakdownMap[cat][subkey] = { key: subkey, label: BREAKDOWN_LABELS[subkey] || subkey, call_count: 0, total_cost: 0 };
      }
      breakdownMap[cat][subkey].call_count++;
      breakdownMap[cat][subkey].total_cost += row.cost_usd || 0;
    }

    // Also include detailed usage logs (with model info, capped for safety)
    const { data: detailedRows } = await sb.from('api_usage_logs')
      .select('provider, model, estimated_cost_usd, timestamp')
      .gte('timestamp', startOfMonth)
      .limit(10000);

    for (const row of (detailedRows || [])) {
      const cat = toCategory(row.provider);
      if (!byCategoryMap[cat]) {
        byCategoryMap[cat] = { category: cat, call_count: 0, total_cost: 0 };
      }
      byCategoryMap[cat].call_count++;
      byCategoryMap[cat].total_cost += row.estimated_cost_usd || 0;
      totalCost += row.estimated_cost_usd || 0;

      const dateKey = row.timestamp ? row.timestamp.substring(0, 10) : 'unknown';
      if (!dailyMap[dateKey]) dailyMap[dateKey] = 0;
      dailyMap[dateKey] += row.estimated_cost_usd || 0;

      // Breakdown by model for Claude/Gemini
      const subkey = row.model || row.provider || 'unknown';
      if (!breakdownMap[cat]) breakdownMap[cat] = {};
      if (!breakdownMap[cat][subkey]) {
        breakdownMap[cat][subkey] = { key: subkey, label: subkey, call_count: 0, total_cost: 0 };
      }
      breakdownMap[cat][subkey].call_count++;
      breakdownMap[cat][subkey].total_cost += row.estimated_cost_usd || 0;
    }

    // Fetch per-API budgets
    const budgetKeys = ['monthly_budget_usd', 'budget_x_api_usd', 'budget_gemini_usd', 'budget_claude_usd'];
    const { data: budgetRows } = await sb.from('settings')
      .select('key, value')
      .in('key', budgetKeys)
      .limit(4);
    const budgetMap = {};
    for (let i = 0; i < (budgetRows || []).length; i++) {
      budgetMap[budgetRows[i].key] = parseFloat(budgetRows[i].value) || 0;
    }

    const dailyEntries = Object.entries(dailyMap);
    const dailyUsage = [];
    for (let i = 0; i < dailyEntries.length; i++) {
      dailyUsage.push({ date: dailyEntries[i][0], daily_cost: dailyEntries[i][1] });
    }
    dailyUsage.sort((a, b) => a.date.localeCompare(b.date));

    const totalBudget = budgetMap.monthly_budget_usd || 33;
    const budgets = {
      x: budgetMap.budget_x_api_usd || 10,
      gemini: budgetMap.budget_gemini_usd || 10,
      claude: budgetMap.budget_claude_usd || 13,
    };

    // Build per-API usage info with breakdown
    const apiCategories = ['x', 'gemini', 'claude'];
    const apis = [];
    for (let i = 0; i < apiCategories.length; i++) {
      const cat = apiCategories[i];
      const usage = byCategoryMap[cat] || { category: cat, call_count: 0, total_cost: 0 };
      const budget = budgets[cat];
      const breakdownValues = Object.values(breakdownMap[cat] || {});
      const breakdown = [];
      for (let j = 0; j < breakdownValues.length; j++) {
        breakdown.push({ ...breakdownValues[j], total_cost: parseFloat(breakdownValues[j].total_cost.toFixed(4)) });
      }
      breakdown.sort((a, b) => b.total_cost - a.total_cost);
      apis.push({
        category: cat,
        call_count: usage.call_count,
        total_cost: parseFloat(usage.total_cost.toFixed(4)),
        budget_usd: budget,
        budget_used_percent: budget > 0 ? parseFloat(((usage.total_cost / budget) * 100).toFixed(1)) : 0,
        breakdown,
      });
    }

    res.json({
      totalCostUsd: parseFloat(totalCost.toFixed(4)),
      budgetUsd: totalBudget,
      budgetUsedPercent: totalBudget > 0 ? parseFloat(((totalCost / totalBudget) * 100).toFixed(1)) : 0,
      apis,
      daily: dailyUsage
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Cost Settings ----

// GET /api/settings/cost - Get cost optimization settings
router.get('/cost', async (req, res) => {
  try {
    const sb = getDb();
    const { data, error } = await sb.from('cost_settings').select('*').limit(1).single();

    if (isTableNotFound(error)) {
      // Table doesn't exist - fallback to settings KV table
      const fallback = await getCostSettingsFromKV(sb);
      return res.json(fallback);
    }

    res.json(data || COST_DEFAULTS);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/settings/cost - Update cost optimization settings
router.put('/cost', async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }
    const sb = getDb();
    // Only allow known cost setting fields
    const updates = { updated_at: new Date().toISOString() };
    for (let i = 0; i < COST_KEYS.length; i++) {
      if (body[COST_KEYS[i]] !== undefined) {
        updates[COST_KEYS[i]] = body[COST_KEYS[i]];
      }
    }

    // Check if row exists
    const { data: existing, error: selectError } = await sb.from('cost_settings').select('id').limit(1).single();

    if (isTableNotFound(selectError)) {
      // Table doesn't exist - fallback to settings KV table
      await saveCostSettingsToKV(sb, updates);
      // Also sync monthly_budget_usd
      if (updates.monthly_budget_usd !== undefined) {
        await sb.from('settings').upsert(
          { key: 'monthly_budget_usd', value: String(updates.monthly_budget_usd) },
          { onConflict: 'key' }
        );
      }
      return res.json({ success: true });
    }

    if (existing) {
      const { error } = await sb.from('cost_settings')
        .update(updates)
        .eq('id', existing.id);
      if (error) throw error;
    } else {
      const { error } = await sb.from('cost_settings').insert(updates);
      if (error) throw error;
    }

    // Also sync monthly_budget_usd to the settings table
    if (updates.monthly_budget_usd !== undefined) {
      await sb.from('settings').upsert(
        { key: 'monthly_budget_usd', value: String(updates.monthly_budget_usd) },
        { onConflict: 'key' }
      );
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Task Model Settings ----

// GET /api/settings/task-models - Get all task model settings
router.get('/task-models', async (req, res) => {
  try {
    const sb = getDb();

    // Default task model settings
    const DEFAULTS = {
      competitor_analysis: { claude_model: 'claude-sonnet-4-5-20250929', gemini_model: 'gemini-2.5-pro', preferred_provider: 'claude', effort: 'high', max_tokens: 2048 },
      tweet_generation: { claude_model: 'claude-sonnet-4-5-20250929', gemini_model: 'gemini-2.5-flash', preferred_provider: 'claude', effort: 'medium', max_tokens: 512 },
      comment_generation: { claude_model: 'claude-haiku-4-5-20251001', gemini_model: 'gemini-2.0-flash', preferred_provider: 'claude', effort: 'low', max_tokens: 256 },
      quote_rt_generation: { claude_model: 'claude-haiku-4-5-20251001', gemini_model: 'gemini-2.0-flash', preferred_provider: 'claude', effort: 'low', max_tokens: 256 },
      performance_summary: { claude_model: 'claude-haiku-4-5-20251001', gemini_model: 'gemini-2.0-flash', preferred_provider: 'claude', effort: 'low', max_tokens: 1024 },
    };

    let rows = [];
    let useKVFallback = false;
    try {
      const { data, error } = await sb.from('task_model_settings')
        .select('*')
        .order('task_type')
        .limit(20);
      if (isTableNotFound(error)) {
        useKVFallback = true;
      } else if (!error && data) {
        rows = data;
      }
    } catch (e) {
      useKVFallback = true;
    }

    // If table doesn't exist, try reading from settings KV fallback
    if (useKVFallback) {
      const kvRows = await loadTaskModelKVRows(sb, DEFAULTS);
      for (let i = 0; i < kvRows.length; i++) {
        rows.push(kvRows[i]);
      }
    }

    // Merge defaults with existing data
    const result = Object.entries(DEFAULTS).map(([taskType, defaults]) => {
      const existing = rows.find(r => r.task_type === taskType);
      return {
        task_type: taskType,
        preferred_provider: existing?.preferred_provider || defaults.preferred_provider,
        claude_model: existing?.claude_model || defaults.claude_model,
        gemini_model: existing?.gemini_model || defaults.gemini_model,
        effort: existing?.effort || defaults.effort,
        max_tokens: existing?.max_tokens || defaults.max_tokens,
      };
    });

    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

const TASK_MODEL_FIELDS = ['claude_model', 'gemini_model', 'preferred_provider', 'effort', 'max_tokens'];

function buildTaskModelUpdates(taskType, body) {
  const updates = { task_type: taskType, updated_at: new Date().toISOString() };
  for (let i = 0; i < TASK_MODEL_FIELDS.length; i++) {
    if (body[TASK_MODEL_FIELDS[i]] !== undefined) {
      updates[TASK_MODEL_FIELDS[i]] = body[TASK_MODEL_FIELDS[i]];
    }
  }
  return updates;
}

// PUT /api/settings/task-models/:taskType - Update task model settings
router.put('/task-models/:taskType', async (req, res) => {
  try {
    const { taskType } = req.params;
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }
    if (!VALID_TASK_TYPES.includes(taskType)) {
      return res.status(400).json({ error: 'Invalid task type' });
    }
    const updates = buildTaskModelUpdates(taskType, body);
    const sb = getDb();

    // Try upsert with preferred_provider first
    let { error } = await sb.from('task_model_settings')
      .upsert(updates, { onConflict: 'task_type' });

    if (isTableNotFound(error)) {
      // Fallback: store in settings KV table as JSON
      await sb.from('settings').upsert(
        { key: `task_model_${taskType}`, value: JSON.stringify(updates) },
        { onConflict: 'key' }
      );
      return res.json({ success: true });
    }

    // If it fails (e.g. preferred_provider column missing), retry without it
    if (error && error.message && error.message.includes('preferred_provider')) {
      delete updates.preferred_provider;
      const retry = await sb.from('task_model_settings')
        .upsert(updates, { onConflict: 'task_type' });
      if (retry.error) throw retry.error;
    } else if (error) {
      throw error;
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Prompt Templates ----

// GET /api/settings/prompts/:taskType - Get prompt template
router.get('/prompts/:taskType', async (req, res) => {
  try {
    const { taskType } = req.params;
    const sb = getDb();

    // Check for custom prompt
    const { data: custom, error: customError } = await sb.from('custom_prompts')
      .select('*')
      .eq('task_type', taskType)
      .single();

    if (isTableNotFound(customError)) {
      // Table doesn't exist - try KV fallback
      const { data: kvRow } = await sb.from('settings')
        .select('value')
        .eq('key', `prompt_${taskType}`)
        .single();
      if (kvRow) {
        try {
          return res.json(JSON.parse(kvRow.value));
        } catch (e) { /* ignore parse error, fall through to defaults */ }
      }
    } else if (custom) {
      return res.json(custom);
    }

    // Return default prompt
    const template = defaultPrompts[taskType] || {};
    const sysPrompt = template['system'] || '';
    const usrTemplate = template['userTemplate'] || '';
    res.json({
      task_type: taskType,
      system_prompt: sysPrompt,
      user_template: usrTemplate,
      is_custom: false
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/settings/prompts/:taskType - Save custom prompt
router.put('/prompts/:taskType', async (req, res) => {
  try {
    const { taskType } = req.params;
    const body = req.body;
    if (!body || typeof body !== 'object') {
      return res.status(400).json({ error: 'Request body must be a JSON object' });
    }
    if (!VALID_TASK_TYPES.includes(taskType)) {
      return res.status(400).json({ error: 'Invalid task type' });
    }
    const { system_prompt, user_template } = body;
    const sb = getDb();

    const promptData = {
      task_type: taskType,
      system_prompt: system_prompt || '',
      user_template: user_template || '',
      is_custom: true,
      updated_at: new Date().toISOString()
    };

    const { error } = await sb.from('custom_prompts').upsert(
      promptData,
      { onConflict: 'task_type' }
    );

    if (isTableNotFound(error)) {
      // Fallback: store in settings KV table as JSON
      await sb.from('settings').upsert(
        { key: `prompt_${taskType}`, value: JSON.stringify(promptData) },
        { onConflict: 'key' }
      );
      return res.json({ success: true });
    }

    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/settings/prompts/:taskType/reset - Reset to default prompt
router.post('/prompts/:taskType/reset', async (req, res) => {
  try {
    const { taskType } = req.params;
    const sb = getDb();

    const template = defaultPrompts[taskType];
    if (!template) {
      return res.status(404).json({ error: 'Default prompt not found for this task type' });
    }

    const promptData = {
      task_type: taskType,
      system_prompt: template.system,
      user_template: template.userTemplate,
      is_custom: false,
      updated_at: new Date().toISOString()
    };

    const { error } = await sb.from('custom_prompts').upsert(
      promptData,
      { onConflict: 'task_type' }
    );

    if (isTableNotFound(error)) {
      // Fallback: store in settings KV table
      await sb.from('settings').upsert(
        { key: `prompt_${taskType}`, value: JSON.stringify(promptData) },
        { onConflict: 'key' }
      );
    } else if (error) {
      throw error;
    }

    res.json({
      success: true,
      system_prompt: template.system,
      user_template: template.userTemplate
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
