const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');
const defaultPrompts = require('../config/prompts');

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

    // Aggregate by type and day in JS
    const byTypeMap = {};
    let totalCost = 0;
    const dailyMap = {};

    for (const row of (usageRows || [])) {
      // By type
      if (!byTypeMap[row.api_type]) {
        byTypeMap[row.api_type] = { api_type: row.api_type, call_count: 0, total_cost: 0 };
      }
      byTypeMap[row.api_type].call_count++;
      byTypeMap[row.api_type].total_cost += row.cost_usd || 0;

      totalCost += row.cost_usd || 0;

      // Daily
      const dateKey = row.created_at ? row.created_at.substring(0, 10) : 'unknown';
      if (!dailyMap[dateKey]) dailyMap[dateKey] = 0;
      dailyMap[dateKey] += row.cost_usd || 0;
    }

    // Also include detailed usage logs
    const { data: detailedRows } = await sb.from('api_usage_logs')
      .select('provider, estimated_cost_usd, timestamp')
      .gte('timestamp', startOfMonth);

    for (const row of (detailedRows || [])) {
      const apiType = row.provider;
      if (!byTypeMap[apiType]) {
        byTypeMap[apiType] = { api_type: apiType, call_count: 0, total_cost: 0 };
      }
      byTypeMap[apiType].call_count++;
      byTypeMap[apiType].total_cost += row.estimated_cost_usd || 0;
      totalCost += row.estimated_cost_usd || 0;

      const dateKey = row.timestamp ? row.timestamp.substring(0, 10) : 'unknown';
      if (!dailyMap[dateKey]) dailyMap[dateKey] = 0;
      dailyMap[dateKey] += row.estimated_cost_usd || 0;
    }

    const usageByType = Object.values(byTypeMap);
    const dailyUsage = Object.entries(dailyMap)
      .map(([date, daily_cost]) => ({ date, daily_cost }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const { data: budgetRow } = await sb.from('settings').select('value').eq('key', 'monthly_budget_usd').single();
    const budget = budgetRow ? parseFloat(budgetRow.value) : 33;

    res.json({
      totalCostUsd: parseFloat(totalCost.toFixed(4)),
      budgetUsd: budget,
      budgetUsedPercent: parseFloat(((totalCost / budget) * 100).toFixed(1)),
      byType: usageByType,
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
    const { data } = await sb.from('cost_settings').select('*').limit(1).single();
    res.json(data || {
      monthly_budget_usd: 33,
      budget_alert_80: true,
      budget_pause_100: true,
      batch_enabled: true,
      cache_enabled: true,
      batch_schedule_hour: 3
    });
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
    const { data: existing } = await sb.from('cost_settings').select('id').limit(1).single();

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
    const { data, error } = await sb.from('task_model_settings')
      .select('*')
      .order('task_type');
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/settings/task-models/:taskType - Update task model settings
router.put('/task-models/:taskType', async (req, res) => {
  try {
    const sb = getDb();
    const { taskType } = req.params;
    const updates = {
      ...req.body,
      task_type: taskType,
      updated_at: new Date().toISOString()
    };

    const { error } = await sb.from('task_model_settings')
      .upsert(updates, { onConflict: 'task_type' });
    if (error) throw error;

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
    const { data: custom } = await sb.from('custom_prompts')
      .select('*')
      .eq('task_type', taskType)
      .single();

    if (custom) {
      res.json(custom);
    } else {
      // Return default prompt
      const template = defaultPrompts[taskType];
      res.json({
        task_type: taskType,
        system_prompt: template ? template.system : '',
        user_template: template ? template.userTemplate : '',
        is_custom: false
      });
    }
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

    const { error } = await sb.from('custom_prompts').upsert({
      task_type: taskType,
      system_prompt: system_prompt || '',
      user_template: user_template || '',
      is_custom: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'task_type' });

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

    const { error } = await sb.from('custom_prompts').upsert({
      task_type: taskType,
      system_prompt: template.system,
      user_template: template.userTemplate,
      is_custom: false,
      updated_at: new Date().toISOString()
    }, { onConflict: 'task_type' });

    if (error) throw error;
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
