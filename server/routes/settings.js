const express = require('express');
const router = express.Router();
const { getDb } = require('../db/database');

// GET /api/settings - Get all settings
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of rows) {
      settings[row.key] = row.value;
    }
    res.json(settings);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/settings - Update settings
router.put('/', (req, res) => {
  try {
    const db = getDb();
    const updates = req.body;

    const upsertStmt = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    const upsertAll = db.transaction((entries) => {
      for (const [key, value] of entries) {
        upsertStmt.run(key, String(value));
      }
    });

    upsertAll(Object.entries(updates));
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/usage - API usage summary
router.get('/usage', (req, res) => {
  try {
    const db = getDb();

    // This month's usage by type
    const usageByType = db.prepare(`
      SELECT api_type, COUNT(*) as call_count, SUM(cost_usd) as total_cost
      FROM api_usage_log
      WHERE created_at >= date('now', 'start of month')
      GROUP BY api_type
    `).all();

    // Daily usage this month
    const dailyUsage = db.prepare(`
      SELECT date(created_at) as date, SUM(cost_usd) as daily_cost
      FROM api_usage_log
      WHERE created_at >= date('now', 'start of month')
      GROUP BY date(created_at)
      ORDER BY date
    `).all();

    // Total this month
    const totalRow = db.prepare(`
      SELECT SUM(cost_usd) as total FROM api_usage_log
      WHERE created_at >= date('now', 'start of month')
    `).get();

    const budgetRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('monthly_budget_usd');
    const budget = budgetRow ? parseFloat(budgetRow.value) : 33;
    const totalCost = totalRow.total || 0;

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
