const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

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

// GET /api/usage - API usage summary
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

module.exports = router;
