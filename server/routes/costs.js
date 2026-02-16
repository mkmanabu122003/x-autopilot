const express = require('express');
const router = express.Router();
const {
  getMonthlyCostSummary,
  getDailyCosts,
  getOptimizationScore,
  checkBudgetStatus
} = require('../services/cost-calculator');

// GET /api/costs/summary - Monthly cost summary
router.get('/summary', async (req, res) => {
  try {
    const summary = await getMonthlyCostSummary();
    const budget = await checkBudgetStatus();
    res.json({
      ...summary,
      budgetUsd: budget.budgetUsd,
      budgetUsedPercent: budget.usedPercent,
      alertLevel: budget.alertLevel,
      shouldPause: budget.shouldPause
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/costs/daily?days=30 - Daily cost trend
router.get('/daily', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const data = await getDailyCosts(days);
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/costs/by-task - Cost breakdown by task type
router.get('/by-task', async (req, res) => {
  try {
    const summary = await getMonthlyCostSummary();
    res.json(summary.byTask);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/costs/by-model - Usage breakdown by model
router.get('/by-model', async (req, res) => {
  try {
    const summary = await getMonthlyCostSummary();
    res.json(summary.byModel);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/costs/optimization-score - Optimization score
router.get('/optimization-score', async (req, res) => {
  try {
    const score = await getOptimizationScore();
    res.json(score);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
