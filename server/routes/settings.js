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

// Fallback: read cost settings from the settings key-value table
async function getCostSettingsFromKV(sb) {
  const kvKeys = COST_KEYS.map(k => `cost_${k}`);
  const { data } = await sb.from('settings').select('key, value').in('key', kvKeys);
  const result = { ...COST_DEFAULTS };
  for (const row of (data || [])) {
    const key = row.key.replace('cost_', '');
    if (row.value === 'true') result[key] = true;
    else if (row.value === 'false') result[key] = false;
    else if (!isNaN(Number(row.value))) result[key] = Number(row.value);
    else result[key] = row.value;
  }
  return result;
}

// Fallback: save cost settings to the settings key-value table
async function saveCostSettingsToKV(sb, updates) {
  for (const key of COST_KEYS) {
    if (updates[key] !== undefined) {
      const { error } = await sb.from('settings').upsert(
        { key: `cost_${key}`, value: String(updates[key]) },
        { onConflict: 'key' }
      );
      if (error) throw error;
    }
  }
}

// GET /api/settings - Get all settings
router.get('/', async (req, res) => {
  try {
    const sb = getDb();
    const { data, error } = await sb.from('settings').select('key, value');
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
    const sb = getDb();
    const updates = req.body;

    for (const [key, value] of Object.entries(updates)) {
      const { error } = await sb.from('settings').upsert(
        { key, value: String(value) },
        { onConflict: 'key' }
      );
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

    // Fetch all usage rows this month
    const { data: usageRows, error: usageError } = await sb.from('api_usage_log')
      .select('api_type, cost_usd, created_at')
      .gte('created_at', startOfMonth);
    if (usageError) throw usageError;

    // Map api_type to category: x_write/x_read/x_user/x_search -> 'x', claude -> 'claude', gemini -> 'gemini'
    const toCategory = (apiType) => {
      if (apiType && apiType.startsWith('x_')) return 'x';
      return apiType || 'other';
    };

    // Aggregate by category and day
    const byCategoryMap = {};
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
    }

    // Also include detailed usage logs
    const { data: detailedRows } = await sb.from('api_usage_logs')
      .select('provider, estimated_cost_usd, timestamp')
      .gte('timestamp', startOfMonth);

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
    }

    const dailyUsage = Object.entries(dailyMap)
      .map(([date, daily_cost]) => ({ date, daily_cost }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Fetch per-API budgets
    const { data: budgetRows } = await sb.from('settings')
      .select('key, value')
      .in('key', ['monthly_budget_usd', 'budget_x_api_usd', 'budget_gemini_usd', 'budget_claude_usd']);
    const budgetMap = {};
    for (const row of (budgetRows || [])) {
      budgetMap[row.key] = parseFloat(row.value) || 0;
    }

    const totalBudget = budgetMap.monthly_budget_usd || 33;
    const budgets = {
      x: budgetMap.budget_x_api_usd || 10,
      gemini: budgetMap.budget_gemini_usd || 10,
      claude: budgetMap.budget_claude_usd || 13,
    };

    // Build per-API usage info
    const apis = ['x', 'gemini', 'claude'].map(cat => {
      const usage = byCategoryMap[cat] || { category: cat, call_count: 0, total_cost: 0 };
      const budget = budgets[cat];
      return {
        category: cat,
        call_count: usage.call_count,
        total_cost: parseFloat(usage.total_cost.toFixed(4)),
        budget_usd: budget,
        budget_used_percent: budget > 0 ? parseFloat(((usage.total_cost / budget) * 100).toFixed(1)) : 0,
      };
    });

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
    const sb = getDb();
    const updates = {
      ...req.body,
      updated_at: new Date().toISOString()
    };

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
      competitor_analysis: { claude_model: 'claude-opus-4-6', gemini_model: 'gemini-2.5-pro', preferred_provider: 'claude', effort: 'high', max_tokens: 2048 },
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
        .order('task_type');
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
      const kvKeys = Object.keys(DEFAULTS).map(t => `task_model_${t}`);
      const { data: kvRows } = await sb.from('settings').select('key, value').in('key', kvKeys);
      for (const row of (kvRows || [])) {
        try {
          const parsed = JSON.parse(row.value);
          rows.push(parsed);
        } catch (e) { /* ignore parse errors */ }
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

// PUT /api/settings/task-models/:taskType - Update task model settings
router.put('/task-models/:taskType', async (req, res) => {
  try {
    const sb = getDb();
    const { taskType } = req.params;

    // Only include known columns to avoid errors with missing columns
    const knownFields = ['claude_model', 'gemini_model', 'preferred_provider', 'effort', 'max_tokens'];
    const updates = { task_type: taskType, updated_at: new Date().toISOString() };
    for (const field of knownFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

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
    const template = defaultPrompts[taskType];
    res.json({
      task_type: taskType,
      system_prompt: template ? template.system : '',
      user_template: template ? template.userTemplate : '',
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
    const { system_prompt, user_template } = req.body;
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
