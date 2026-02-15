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

module.exports = router;
